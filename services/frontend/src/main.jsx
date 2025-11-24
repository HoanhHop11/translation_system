import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import './styles/utilities.css'
import './styles/room.css'
import './styles/translation.css'
import './styles/compat.css'  // Missing component-specific styles (speaking badge, empty states, etc.)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
