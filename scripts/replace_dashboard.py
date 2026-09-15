from pathlib import Path
import re

src_path = Path("src/App.tsx")
src = src_path.read_text()

start_marker = '<main className="max-w-screen-xl mx-auto px-4 sm:px-6 py-6 pb-24">\n          {!agentDetailId && mainView === \'dashboard\' && ('
end_pattern = re.compile(r"              </div>\n            </>\n          \}\)\n")

start_idx = src.index(start_marker) + len(start_marker)
end_match = end_pattern.search(src, start_idx)
end_idx = end_match.end()

old_block = src[start_idx:end_idx]
print(f"block starts at line {src[:start_idx].count(chr(10))+1}")
print(f"block ends at line {src[:end_idx].count(chr(10))+1}")
print(f"block length: {len(old_block)} chars")

# NOTE: this script is currently unused. The Fase 3 DashboardView exists
# but has not been wired because we need to address higher-priority UX
# fixes first (sticky nav, badge overlap, banner sizing) per the
# 2026-09-15 review. Once those land, revisit wiring DashboardView.
new_block = """<DashboardView
              agents={displayedAgents}
              events={displayedEvents}
              nfts={displayedNFTs}
              dataLoaded={dataLoaded}
              isPlatformView={isPlatformView}
              onSelectAgent={(agent) => agent ? setSelectedAgent(agent) : setSelectedAgent(null)}
              onOpenAgent={(agent) => setAgentDetailId(agent.id)}
              onSpawnAgent={() => walletConnected ? setSpawnDialogOpen(true) : handleWalletConnect("")}
              onConnectWallet={() => handleWalletConnect("")}
              onOpenMyAgents={() => setMainView("my-agents")}
              onOpenMarket={() => setMainView("market")}
              onRunAutoScout={(id) => handleRunAutoScout(id)}
              onChatAgent={(agent) => handleChatWithAgent(agent)}
            />
          )}

"""

# Intentionally do not write yet — see comment above.
print("[skip] wire intentionally disabled. Re-enable after P0-P2 fixes ship.")
