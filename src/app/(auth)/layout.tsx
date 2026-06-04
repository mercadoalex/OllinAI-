"use client"

import Link from "next/link"

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen flex">
      {/* Left side - Branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-gray-900 text-white flex-col justify-between p-12">
        <div>
          <Link href="/" className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-white/10 flex items-center justify-center">
              <span className="text-lg font-bold">O</span>
            </div>
            <span className="text-xl font-semibold">OllinAI</span>
          </Link>
        </div>
        
        <div className="space-y-6">
          <h1 className="text-4xl font-bold leading-tight">
            Change Intelligence for Modern DevOps
          </h1>
          <p className="text-lg text-gray-400 max-w-md">
            Predict deployment risks, track DORA metrics, and reduce change failure rates with ML-powered insights.
          </p>
          
          <div className="grid grid-cols-2 gap-6 pt-8">
            <div className="space-y-1">
              <p className="text-3xl font-bold">87%</p>
              <p className="text-sm text-gray-400">Prediction Accuracy</p>
            </div>
            <div className="space-y-1">
              <p className="text-3xl font-bold">2.1h</p>
              <p className="text-sm text-gray-400">Average MTTR</p>
            </div>
            <div className="space-y-1">
              <p className="text-3xl font-bold">45%</p>
              <p className="text-sm text-gray-400">Fewer Incidents</p>
            </div>
            <div className="space-y-1">
              <p className="text-3xl font-bold">500+</p>
              <p className="text-sm text-gray-400">Teams Using OllinAI</p>
            </div>
          </div>
        </div>
        
        <p className="text-sm text-gray-500">
          Trusted by engineering teams at leading companies worldwide.
        </p>
      </div>
      
      {/* Right side - Auth Form */}
      <div className="flex-1 flex items-center justify-center p-8 bg-gray-50">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="lg:hidden mb-8 flex justify-center">
            <Link href="/" className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-gray-900 flex items-center justify-center">
                <span className="text-lg font-bold text-white">O</span>
              </div>
              <span className="text-xl font-semibold text-gray-900">OllinAI</span>
            </Link>
          </div>
          
          {children}
        </div>
      </div>
    </div>
  )
}
