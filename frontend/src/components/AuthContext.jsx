"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState("operator"); // "operator" | "engineer"
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  // Load state from localStorage on mount
  useEffect(() => {
    const storedAuth = localStorage.getItem("vd_auth_state");
    if (storedAuth) {
      try {
        const parsed = JSON.parse(storedAuth);
        setUser(parsed.user);
        setRole(parsed.role);
        setIsAuthenticated(parsed.isAuthenticated);
      } catch (e) {
        console.error("Error loading auth state", e);
      }
    }
  }, []);

  // Sync state to localStorage on update
  const saveState = (userVal, roleVal, authVal) => {
    setUser(userVal);
    setRole(roleVal);
    setIsAuthenticated(authVal);
    if (authVal) {
      localStorage.setItem(
        "vd_auth_state",
        JSON.stringify({ user: userVal, role: roleVal, isAuthenticated: authVal })
      );
    } else {
      localStorage.removeItem("vd_auth_state");
    }
  };

  const login = (userId, securityCode, selectedRole) => {
    // Basic mock authentication: any non-empty credential works
    if (!userId) return { success: false, error: "Please enter Operator ID / Email" };
    if (!securityCode) return { success: false, error: "Please enter Security PIN / Password" };

    const username = userId.trim();
    saveState(username, selectedRole, true);
    
    // Default redirect to projects dashboard
    router.push("/projects");
    return { success: true };
  };

  const logout = () => {
    saveState(null, "operator", false);
    router.push("/login");
  };

  // Redirect to login if not authenticated and trying to access private page
  useEffect(() => {
    const isPublicPage = pathname === "/" || pathname === "/login";
    if (!isAuthenticated && !isPublicPage) {
      router.push("/login");
    }
  }, [pathname, isAuthenticated, router]);

  return (
    <AuthContext.Provider value={{ user, role, isAuthenticated, login, logout, setRole }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
