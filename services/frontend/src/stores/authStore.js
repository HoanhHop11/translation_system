import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const useAuthStore = create(
  persist(
    (set) => ({
      user: null,
      token: null,
      refreshToken: null,
      isAuthenticated: false,

      login: (userData, accessToken, refreshToken) => {
        set({
          user: userData,
          token: accessToken,
          refreshToken: refreshToken,
          isAuthenticated: true,
        })
      },

      logout: () => {
        set({
          user: null,
          token: null,
          refreshToken: null,
          isAuthenticated: false,
        })
      },

      updateToken: (newToken) => {
        set({ token: newToken })
      },

      updateUser: (userData) => {
        set({ user: userData })
      },
    }),
    {
      name: 'auth-storage',
    }
  )
)
