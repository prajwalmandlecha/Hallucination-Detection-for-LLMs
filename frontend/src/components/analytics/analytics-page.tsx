import { motion } from "framer-motion";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

// Mock data
const modelStats = [
  { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B", confidence: 0.92, hallucinations: 12, sources: 45 },
  { id: "deepseek-chat", name: "DeepSeek Chat", confidence: 0.88, hallucinations: 18, sources: 32 },
  { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", confidence: 0.95, hallucinations: 5, sources: 60 },
  { id: "gpt-4-turbo", name: "GPT-4 Turbo", confidence: 0.94, hallucinations: 8, sources: 55 },
];

const timeData = [
  { name: "Mon", hallucinations: 4, confidence: 0.91 },
  { name: "Tue", hallucinations: 3, confidence: 0.92 },
  { name: "Wed", hallucinations: 7, confidence: 0.89 },
  { name: "Thu", hallucinations: 2, confidence: 0.95 },
  { name: "Fri", hallucinations: 5, confidence: 0.93 },
  { name: "Sat", hallucinations: 1, confidence: 0.96 },
  { name: "Sun", hallucinations: 8, confidence: 0.88 },
];

const COLORS = ["#0088FE", "#00C49F", "#FFBB28", "#FF8042"];

export function AnalyticsPage() {
  return (
    <div className="relative flex flex-col h-full w-full bg-app overflow-y-auto overflow-x-hidden text-pri p-4 sm:p-8">
      {/* Grid Background */}
      <div className="absolute inset-0 pointer-events-none z-0">
        <div 
          className="absolute inset-0 opacity-[0.05] dark:opacity-[0.1]"
          style={{
            backgroundImage: `linear-gradient(to right, #808080 1px, transparent 1px), linear-gradient(to bottom, #808080 1px, transparent 1px)`,
            backgroundSize: `40px 40px`
          }}
        />
        <div className="absolute inset-0 bg-app [mask-image:radial-gradient(ellipse_at_center,transparent_20%,black)]"></div>
      </div>

      <div className="relative z-10 w-full max-w-7xl mx-auto flex flex-col gap-8">
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-pri">Analytics Dashboard</h1>
          <p className="text-mut mt-2">Monitor model performance, hallucination rates, and confidence scores across the selected models.</p>
        </motion.div>

        {/* Top Charts Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          {/* Main Chart: Hallucinations Over Time */}
          <motion.div 
             className="md:col-span-2 rounded-xl"
             initial={{ opacity: 0, scale: 0.95 }} 
             animate={{ opacity: 1, scale: 1 }} 
             transition={{ duration: 0.5, delay: 0.1 }}
          >
            <Card className="h-full bg-pane/80 backdrop-blur-md border-subtle shadow-xl shadow-black/5 dark:shadow-black/20">
              <CardHeader>
                <CardTitle>Hallucinations Over Time</CardTitle>
                <CardDescription>Daily count of detected unsupported claims</CardDescription>
              </CardHeader>
              <CardContent className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={timeData} margin={{ top: 10, right: 30, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorHal" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="name" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: 'var(--pane)', borderColor: 'var(--border-subtle)', borderRadius: '8px' }}
                      itemStyle={{ color: 'var(--pri)' }}
                    />
                    <Area type="monotone" dataKey="hallucinations" stroke="#ef4444" fillOpacity={1} fill="url(#colorHal)" />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </motion.div>

          {/* Pie Chart: Model Distribution */}
          <motion.div 
             className="rounded-xl"
             initial={{ opacity: 0, scale: 0.95 }} 
             animate={{ opacity: 1, scale: 1 }} 
             transition={{ duration: 0.5, delay: 0.2 }}
          >
            <Card className="h-full bg-pane/80 backdrop-blur-md border-subtle shadow-xl shadow-black/5 dark:shadow-black/20">
              <CardHeader>
                <CardTitle>Source Usage</CardTitle>
                <CardDescription>Verified claims by model</CardDescription>
              </CardHeader>
              <CardContent className="h-[300px] flex items-center justify-center -mt-6">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={modelStats}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="sources"
                    >
                      {modelStats.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip 
                      contentStyle={{ backgroundColor: 'var(--pane)', borderColor: 'var(--border-subtle)', borderRadius: '8px', color: 'var(--pri)' }}
                      itemStyle={{ color: 'var(--pri)' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </motion.div>
        </div>

        {/* Model Cards Bento Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {modelStats.map((model, idx) => (
            <motion.div 
              key={model.id}
              className="rounded-xl flex h-full"
              initial={{ opacity: 0, y: 30 }} 
              animate={{ opacity: 1, y: 0 }} 
              transition={{ duration: 0.6, delay: 0.2 + (idx * 0.1) }}
            >
              <Card className="flex flex-col flex-1 w-full bg-pane/80 backdrop-blur-md border-subtle shadow-lg hover:shadow-xl hover:-translate-y-1 transition-all duration-300 shadow-black/5 dark:shadow-black/20 group">
                <CardHeader>
                  <CardTitle className="text-lg group-hover:text-amber-500 transition-colors">{model.name}</CardTitle>
                  <CardDescription className="text-xs truncate">{model.id}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-5 flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-mut text-sm">Confidence Score</span>
                    <span className="font-bold text-pri">{(model.confidence * 100).toFixed(1)}%</span>
                  </div>
                  <div className="w-full bg-border-subtle rounded-full h-2 overflow-hidden">
                    <motion.div 
                      className="bg-amber-500 h-2 rounded-full" 
                      initial={{ width: 0 }}
                      animate={{ width: `${model.confidence * 100}%` }}
                      transition={{ duration: 1, delay: 0.5 + (idx * 0.1) }}
                    />
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4 mt-6">
                    <div className="flex flex-col items-center p-3 bg-app/50 rounded-lg border border-subtle/50">
                      <span className="text-3xl font-black text-red-500 tracking-tighter">{model.hallucinations}</span>
                      <span className="text-[10px] text-mut uppercase font-semibold mt-1">Hallucinations</span>
                    </div>
                    <div className="flex flex-col items-center p-3 bg-app/50 rounded-lg border border-subtle/50">
                      <span className="text-3xl font-black text-green-500 tracking-tighter">{model.sources}</span>
                      <span className="text-[10px] text-mut uppercase font-semibold mt-1">Sources</span>
                    </div>
                  </div>
                </CardContent>
                <div className="p-4 pt-0 mt-auto">
                    <Button variant="outline" className="w-full bg-transparent hover:bg-hover border-subtle text-pri hover:text-pri transition-colors">
                      View More
                    </Button>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
