import Sidebar from './Sidebar';
import { Outlet } from 'react-router-dom';
import { useState, createContext, useContext } from 'react';

const SidebarContext = createContext();

export function useSidebar() {
  return useContext(SidebarContext);
}

export default function Layout() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <SidebarContext.Provider value={{ collapsed, setCollapsed }}>
      <div className="flex min-h-screen bg-[#0a0f1a]">
        <Sidebar />
        <main
          className="flex-1 p-6 lg:p-8 transition-all duration-300"
          style={{ marginLeft: collapsed ? 68 : 240 }}
        >
          <Outlet />
        </main>
      </div>
    </SidebarContext.Provider>
  );
}
