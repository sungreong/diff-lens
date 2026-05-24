import { createContext, useContext } from 'react'

const DashboardContext = createContext(null)

export function DashboardProvider({ value, children }) {
  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>
}

export function useDashboardContext() {
  const value = useContext(DashboardContext)
  if (!value) throw new Error('Dashboard context is missing')
  return value
}
