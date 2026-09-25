import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CaretDown } from '@phosphor-icons/react'

const FAQS = [
  {
    q: 'Is this on mainnet?',
    a: 'Testnet only right now — BNB Smart Chain Testnet, Mantle Sepolia and Ethereum Sepolia. No real funds are at risk.',
  },
  {
    q: 'How does my agent learn?',
    a: 'Two ways. Manually: paste a YouTube link from the Dashboard ("Analyze YouTube URL") and it learns right away. Automatically: switch on Auto-Scout on the agent\'s card and it searches its niche for relevant videos every 6 hours. Every lesson is saved; every level-up is minted on-chain as a learning proof.',
  },
  {
    q: 'Will my agent trade with my money?',
    a: 'No. It reads live market data from CoinMarketCap and CoinGecko and suggests a next step as a proposal. Nothing happens until you approve it with your own wallet signature — no autonomous trading is enabled.',
  },
  {
    q: "Who controls my agent's wallet?",
    a: "Each agent gets its own wallet. Its private key is encrypted with Google Cloud KMS and managed by ASAJU so the agent can sign its own transactions — you never share your personal wallet's keys. Anything that matters, like approving a proposal, still requires your signature.",
  },
  {
    q: "What if my agent runs out of gas?",
    a: "Every agent is funded with a gas reserve when it spawns. If it runs low, you can top it up anytime from its wallet address — it pays for its own transactions from there.",
  },
  {
    q: 'Which testnet should I pick?',
    a: 'Same agent behaviour on all of them — pick whichever testnet you already have faucet funds on. BNB Testnet and Ethereum Sepolia run the newer contract, where you own your agent on-chain and can transfer it; Mantle Sepolia still runs the previous version.',
  },
  {
    q: 'When is mainnet?',
    a: "We're focused on testnet first — mainnet timing depends on every feature working reliably end-to-end. No promises until that's true.",
  },
]

export function FAQSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  return (
    <section className="max-w-screen-xl mx-auto px-4 sm:px-6 py-20">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        className="text-center mb-12"
      >
        <p className="text-xs font-mono uppercase tracking-widest text-violet-400/60 mb-3">FAQ</p>
        <h2 className="text-2xl sm:text-4xl font-black mb-3 text-white">Before you spawn one</h2>
      </motion.div>

      <div className="max-w-2xl mx-auto space-y-3">
        {FAQS.map((item, i) => {
          const isOpen = openIndex === i
          return (
            <motion.div
              key={item.q}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.05 }}
              className="rounded-xl border border-cyan-500/15 bg-[#0f1124]/60 backdrop-blur-sm overflow-hidden"
            >
              <button
                onClick={() => setOpenIndex(isOpen ? null : i)}
                className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left"
              >
                <span className="text-sm font-semibold text-white">{item.q}</span>
                <CaretDown
                  size={16}
                  className="text-cyan-400/60 flex-shrink-0 transition-transform duration-300"
                  style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
                />
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25 }}
                    className="overflow-hidden"
                  >
                    <p className="px-5 pb-4 text-sm text-slate-400 leading-relaxed">{item.a}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )
        })}
      </div>
    </section>
  )
}
