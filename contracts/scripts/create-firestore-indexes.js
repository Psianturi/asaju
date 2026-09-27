/**
 * Firestore composite index creator.
 *
 * The owner inbox endpoint runs three composite queries against `scout_logs`
 * and `proposals`. Firestore does not auto-create those indexes, so until they
 * are deployed the endpoint logs `FailedPrecondition` and returns empty
 * data because `_safe_call` swallows the error. This script deploys the
 * missing indexes via the Firestore Admin REST API in one shot.
 *
 * Run once per environment (dev / staging / prod) with service-account
 * credentials. The script is idempotent — re-running after an index already
 * exists returns ALREADY_EXISTS, which is fine.
 */

const { Firestore } = require('@google-cloud/firestore');
require('dotenv').config();

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'agentic-event-factory';
const DATABASE_ID = '(default)';

// One entry per composite index we need. `collection` is the parent,
// `fields` is the indexed field list (mirrors the query exactly — order
// matters for range + inequality fields). `queryScope` = COLLECTION.
const INDEXES = [
  {
    collection: 'scout_logs',
    fields: [
      { fieldPath: 'agent_id',   order: 'ASCENDING'  },
      { fieldPath: 'action',     order: 'ASCENDING'  },
      { fieldPath: 'run_at',     order: 'DESCENDING' },
    ],
    description: 'agent_id + action + run_at DESC — used by inbox /recent_mints',
  },
  {
    collection: 'scout_logs',
    fields: [
      { fieldPath: 'agent_id',   order: 'ASCENDING'  },
      { fieldPath: 'run_at',     order: 'DESCENDING' },
    ],
    description: 'agent_id + run_at DESC — used by inbox /recent_scout_runs',
  },
  {
    collection: 'proposals',
    fields: [
      { fieldPath: 'agent_id',   order: 'ASCENDING'  },
      { fieldPath: 'status',     order: 'ASCENDING'  },
      { fieldPath: 'created_at',  order: 'DESCENDING' },
    ],
    description: 'agent_id + status + created_at DESC — pending-proposals inbox',
  },
];

async function ensureIndex(firestore, def) {
  const indexName = `idx-${def.collection}-${def.fields.map((f) => `${f.fieldPath}:${f.order.slice(0, 3).toLowerCase()}`).join('-')}`;
  try {
    await firestore.collection(def.collection).doc('__index_check__').get();
  } catch (e) {
    // best-effort connectivity probe; ignore
  }

  try {
    // Firestore Admin API: create index
    const admin = require('@google-cloud/firestore').Firestore.prototype;
    const parent = `projects/${PROJECT_ID}/databases/${DATABASE_ID}/collectionGroups/${def.collection}`;
    const fields = def.fields.map((f, i) => ({
      fieldPath: f.fieldPath,
      indexConfig: { order: f.order, scope: i === def.fields.length - 1 ? 'DESCENDING_SCOPE' : 'ASCENDING_SCOPE' },
    }));

    // Build the API call manually (Firestore client SDK doesn't expose createIndex).
    const { FirestoreAdminClient } = require('@google-cloud/firestore');
    const adminClient = new FirestoreAdminClient();
    const [operation] = await adminClient.createIndex({
      parent,
      index: {
        queryScope: 'COLLECTION',
        fields: def.fields.map((f, i) => ({
          fieldPath: f.fieldPath,
          order: f.order,
          ...(i === def.fields.length - 1 && { config: { descending: true } }),
        })),
      },
    });
    console.log(`  ✓ creating index on ${def.collection} (${indexName}) — operation ${operation.name.split('/').pop()}`);
    return operation.promise();
  } catch (err) {
    if (err.code === 9 || err.message?.includes('ALREADY_EXISTS') || err.message?.includes('already exists')) {
      console.log(`  ✓ index on ${def.collection} already exists — skipping`);
      return Promise.resolve();
    }
    throw err;
  }
}

async function main() {
  console.log(`Creating Firestore indexes in project ${PROJECT_ID}…`);
  const firestore = new Firestore({ projectId: PROJECT_ID });
  for (const def of INDEXES) {
    console.log(`\n${def.description}`);
    try {
      await ensureIndex(firestore, def);
    } catch (err) {
      console.error(`  ✗ failed: ${err.message ?? err.code ?? err}`);
      process.exitCode = 1;
    }
  }
  console.log('\nDone. Indexes take 1-2 minutes to build before queries succeed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
