import { useMemo } from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Agent, Event, NFT } from '@/lib/types'
import { TrendUp, TrendDown, Coins, ChartLine, Globe, Lightning, Sparkle, Wallet } from '@phosphor-icons/react'
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area, Legend } from 'recharts'
import { motion } from 'framer-motion'
import { calculateRarityTier, getRarityLabel } from '@/lib/utils'
import { getChain, DEFAULT_CHAIN_ID } from '@/lib/blockchain/chains'

interface AnalyticsChartsProps {
  agents?: Agent[]
  events?: Event[]
  nfts?: NFT[]
}

export function AnalyticsCharts({ agents = [], events = [], nfts = [] }: AnalyticsChartsProps) {
  const eventTrendData = useMemo(() => {
    const last7Days = Array.from({ length: 7 }, (_, i) => {
      const date = new Date()
      date.setDate(date.getDate() - (6 - i))
      date.setHours(0, 0, 0, 0)
      return {
        date: date.getTime(),
        label: date.toLocaleDateString('en', { weekday: 'short' })
      }
    })

    return last7Days.map(day => {
      const dayEnd = day.date + 24 * 60 * 60 * 1000
      const eventsCount = events.filter(e => e.date >= day.date && e.date < dayEnd).length
      const nftsCount = nfts.filter(n => n.date >= day.date && n.date < dayEnd).length
      
      return {
        day: day.label,
        events: eventsCount,
        nfts: nftsCount
      }
    })
  }, [events, nfts])

  const platformDistribution = useMemo(() => {
    const platforms = events.reduce((acc, event) => {
      acc[event.platform] = (acc[event.platform] || 0) + 1
      return acc
    }, {} as Record<string, number>)

    return Object.entries(platforms).map(([name, value]) => ({ name, value }))
  }, [events])

  const nicheDistribution = useMemo(() => {
    const niches = agents.reduce((acc, agent) => {
      acc[agent.niche] = (acc[agent.niche] || 0) + agent.eventsAttended
      return acc
    }, {} as Record<string, number>)

    return Object.entries(niches).map(([name, value]) => ({ name, value }))
  }, [agents])

  const agentPerformance = useMemo(() => {
    return agents.map(agent => ({
      name: agent.name.split(' ')[0],
      events: agent.eventsAttended,
      level: agent.level,
      gas: agent.gasSpent || 0
    })).sort((a, b) => b.events - a.events).slice(0, 5)
  }, [agents])

  const gasUsageTrend = useMemo(() => {
    return agents.map(agent => ({
      name: agent.name.split(' ')[0],
      spent: agent.gasSpent || 0,
      balance: agent.nativeBalance || 0
    }))
  }, [agents])

  const totalEvents = events.length
  const totalGasSpent = agents.reduce((sum, a) => sum + (a.gasSpent || 0), 0)

  // Agents can sit on different chains, so one currency label is only honest
  // when they all share it. Mixed fleets get a neutral label instead.
  const gasSymbol = useMemo(() => {
    const symbols = new Set(
      agents.map(a => getChain(a.chainId ?? DEFAULT_CHAIN_ID)?.nativeSymbol ?? '?'),
    )
    return symbols.size === 1 ? [...symbols][0] : 'native tokens'
  }, [agents])
  const avgEventsPerAgent = agents.length > 0 ? (totalEvents / agents.length).toFixed(1) : '0'
  const wisdomUnlockedCount = agents.filter(a => a.wisdomUnlocked).length

  const eventGrowth = useMemo(() => {
    const recent = eventTrendData.slice(-3).reduce((sum, d) => sum + d.events, 0)
    const previous = eventTrendData.slice(0, 3).reduce((sum, d) => sum + d.events, 0)
    if (previous === 0) return '0'
    return ((recent - previous) / previous * 100).toFixed(1)
  }, [eventTrendData])

  const rarityDistribution = useMemo(() => {
    const rarityCount = agents.reduce((acc, agent) => {
      const rarity = agent.rarityTier || calculateRarityTier(agent)
      acc[rarity] = (acc[rarity] || 0) + 1
      return acc
    }, {} as Record<string, number>)

    const rarityOrder: Array<{tier: string, color: string}> = [
      { tier: 'common', color: '#9ca3af' },
      { tier: 'rare', color: '#00f3ff' },
      { tier: 'epic', color: '#9d00ff' },
      { tier: 'legendary', color: '#ff8800' },
      { tier: 'mythic', color: '#ffd700' }
    ]

    return rarityOrder
      .filter(r => rarityCount[r.tier])
      .map(r => ({ 
        name: getRarityLabel(r.tier as any), 
        value: rarityCount[r.tier],
        color: r.color
      }))
  }, [agents])

  const COLORS = ['#00f3ff', '#9d00ff', '#ff006e', '#06ffa5', '#ffd60a']

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 }}>
          <Card className="glass-card-hover p-5 relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-primary/20 to-transparent rounded-full blur-3xl" />
            <div className="relative">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Total Events</p>
                <Lightning size={20} className="text-primary" weight="duotone" />
              </div>
              <p className="text-3xl font-bold mb-1">{totalEvents}</p>
              <div className="flex items-center gap-2 text-xs">
                {parseFloat(eventGrowth) >= 0 ? (
                  <>
                    <TrendUp size={16} className="text-green-500" weight="bold" />
                    <span className="text-green-500 font-semibold">+{eventGrowth}%</span>
                  </>
                ) : (
                  <>
                    <TrendDown size={16} className="text-red-500" weight="bold" />
                    <span className="text-red-500 font-semibold">{eventGrowth}%</span>
                  </>
                )}
                <span className="text-muted-foreground">this week</span>
              </div>
            </div>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card className="glass-card-hover p-5 relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-secondary/20 to-transparent rounded-full blur-3xl" />
            <div className="relative">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Gas Spent</p>
                <Coins size={20} className="text-secondary" weight="duotone" />
              </div>
              <p className="text-3xl font-bold mb-1">{totalGasSpent.toFixed(3)}</p>
              <p className="text-xs text-muted-foreground font-mono">{gasSymbol}</p>
            </div>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card className="glass-card-hover p-5 relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-accent/20 to-transparent rounded-full blur-3xl" />
            <div className="relative">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Avg per Agent</p>
                <ChartLine size={20} className="text-accent" weight="duotone" />
              </div>
              <p className="text-3xl font-bold mb-1">{avgEventsPerAgent}</p>
              <p className="text-xs text-muted-foreground">videos analyzed</p>
            </div>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <Card className="glass-card-hover p-5 relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-amber-500/20 to-transparent rounded-full blur-3xl" />
            <div className="relative">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Wisdom Unlocked</p>
                <Globe size={20} className="text-amber-500" weight="duotone" />
              </div>
              <p className="text-3xl font-bold mb-1">{wisdomUnlockedCount}</p>
              <p className="text-xs text-muted-foreground">of {agents.length} agents</p>
            </div>
          </Card>
        </motion.div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
          <Card className="glass-card-hover p-6 border-2 border-primary/20">
            <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
              <Lightning className="text-primary" weight="duotone" size={22} />
              <span>Event Activity Trend</span>
            </h3>
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={eventTrendData}>
                <defs>
                  <linearGradient id="colorEvents" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#00f3ff" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#00f3ff" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorNFTs" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#9d00ff" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#9d00ff" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis 
                  dataKey="day" 
                  stroke="#60606a" 
                  style={{ fontSize: '12px', fontFamily: 'Inter' }}
                />
                <YAxis 
                  stroke="#60606a" 
                  style={{ fontSize: '12px', fontFamily: 'Inter' }}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'rgba(26, 27, 58, 0.95)', 
                    border: '1px solid rgba(0, 243, 255, 0.3)',
                    borderRadius: '8px',
                    backdropFilter: 'blur(10px)'
                  }}
                  labelStyle={{ color: '#fff', fontWeight: 'bold' }}
                />
                <Legend wrapperStyle={{ fontSize: '13px', fontFamily: 'Inter' }} />
                <Area 
                  type="monotone" 
                  dataKey="events" 
                  stroke="#00f3ff" 
                  strokeWidth={2}
                  fillOpacity={1} 
                  fill="url(#colorEvents)" 
                  name="Events"
                />
                <Area 
                  type="monotone" 
                  dataKey="nfts" 
                  stroke="#9d00ff" 
                  strokeWidth={2}
                  fillOpacity={1} 
                  fill="url(#colorNFTs)" 
                  name="NFTs Minted"
                />
              </AreaChart>
            </ResponsiveContainer>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
          <Card className="glass-card-hover p-6 border-2 border-secondary/20">
            <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
              <ChartLine className="text-secondary" weight="duotone" size={22} />
              <span>Top Agent Performance</span>
            </h3>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={agentPerformance}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis 
                  dataKey="name" 
                  stroke="#60606a" 
                  style={{ fontSize: '12px', fontFamily: 'Inter' }}
                />
                <YAxis 
                  stroke="#60606a" 
                  style={{ fontSize: '12px', fontFamily: 'Inter' }}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'rgba(26, 27, 58, 0.95)', 
                    border: '1px solid rgba(157, 0, 255, 0.3)',
                    borderRadius: '8px',
                    backdropFilter: 'blur(10px)'
                  }}
                  labelStyle={{ color: '#fff', fontWeight: 'bold' }}
                />
                <Bar 
                  dataKey="events" 
                  fill="#9d00ff" 
                  radius={[8, 8, 0, 0]}
                  name="Videos Analyzed"
                />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </motion.div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}>
          <Card className="glass-card-hover p-6 border-2 border-accent/20">
            <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
              <Globe className="text-accent" weight="duotone" size={22} />
              <span>Platform Distribution</span>
            </h3>
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={platformDistribution}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {platformDistribution.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'rgba(26, 27, 58, 0.95)', 
                    border: '1px solid rgba(0, 243, 255, 0.3)',
                    borderRadius: '8px',
                    backdropFilter: 'blur(10px)'
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 }}>
          <Card className="glass-card-hover p-6 border-2 border-primary/20">
            <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
              <Lightning className="text-primary" weight="duotone" size={22} />
              <span>Events by Niche</span>
            </h3>
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={nicheDistribution}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {nicheDistribution.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'rgba(26, 27, 58, 0.95)', 
                    border: '1px solid rgba(157, 0, 255, 0.3)',
                    borderRadius: '8px',
                    backdropFilter: 'blur(10px)'
                  }}
                />
                <Legend 
                  wrapperStyle={{ fontSize: '11px', fontFamily: 'Inter' }}
                  iconSize={10}
                />
              </PieChart>
            </ResponsiveContainer>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8 }}>
          <Card className="glass-card-hover p-6 border-2 border-secondary/20">
            <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
              <Coins className="text-secondary" weight="duotone" size={22} />
              <span>Gas Usage Overview</span>
            </h3>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={gasUsageTrend} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis 
                  type="number"
                  stroke="#60606a" 
                  style={{ fontSize: '11px', fontFamily: 'JetBrains Mono' }}
                />
                <YAxis 
                  type="category"
                  dataKey="name" 
                  stroke="#60606a" 
                  style={{ fontSize: '11px', fontFamily: 'Inter' }}
                  width={70}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'rgba(26, 27, 58, 0.95)', 
                    border: '1px solid rgba(0, 243, 255, 0.3)',
                    borderRadius: '8px',
                    backdropFilter: 'blur(10px)'
                  }}
                  labelStyle={{ color: '#fff', fontWeight: 'bold' }}
                />
                <Bar 
                  dataKey="spent" 
                  fill="#00f3ff" 
                  radius={[0, 8, 8, 0]}
                  name={`Gas Spent (${gasSymbol})`}
                />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </motion.div>
      </div>

      {rarityDistribution.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.9 }}>
          <Card className="glass-card-hover p-6 border-2 border-accent/20">
            <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
              <Sparkle className="text-accent" weight="duotone" size={22} />
              <span>Agent Rarity Distribution</span>
            </h3>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={rarityDistribution}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  fill="#8884d8"
                  paddingAngle={3}
                  dataKey="value"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  labelLine={true}
                >
                  {rarityDistribution.map((entry, index) => (
                    <Cell key={`cell-rarity-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'rgba(26, 27, 58, 0.95)', 
                    border: '1px solid rgba(0, 243, 255, 0.3)',
                    borderRadius: '8px',
                    backdropFilter: 'blur(10px)'
                  }}
                  labelStyle={{ color: '#fff', fontWeight: 'bold' }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-2">
              {rarityDistribution.map((item, index) => (
                <div key={`legend-${index}`} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-card/50 border border-border/30">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
                  <div className="flex-1">
                    <p className="text-xs font-semibold">{item.name}</p>
                    <p className="text-xs text-muted-foreground">{item.value} agents</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </motion.div>
      )}
    </div>
  )
}
