import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WebRTCProvider } from './contexts/WebRTCContext'
import { ToastProvider } from './contexts/ToastContext'
import { TranslationProvider } from './contexts/TranslationContext'
import RoomMeet from './pages/RoomMeet'
import Home from './pages/Home'
import './App.css'

const queryClient = new QueryClient()

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <WebRTCProvider>
          <TranslationProvider>
            <Router>
              <div className="app-container">
                <Routes>
                  <Route path="/" element={<Home />} />
                  <Route path="/room/:roomId" element={<RoomMeet />} />
                </Routes>
              </div>
            </Router>
          </TranslationProvider>
        </WebRTCProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

export default App
