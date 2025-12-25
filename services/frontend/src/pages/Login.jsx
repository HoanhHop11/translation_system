import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { authAPI } from '../services/api'
import { useAuthStore } from '../stores/authStore'
import Logo from '../assets/JBCalling_Web_Teal.svg'

export default function Login() {
  const navigate = useNavigate()
  const login = useAuthStore((state) => state.login)
  
  const [formData, setFormData] = useState({
    username: '',
    password: '',
  })
  const [error, setError] = useState('')

  const loginMutation = useMutation({
    mutationFn: ({ username, password }) => authAPI.login(username, password),
    onSuccess: (data) => {
      login(data.user, data.access_token, data.refresh_token)
      navigate('/')
    },
    onError: (err) => {
      setError(err.response?.data?.detail || 'Đăng nhập thất bại')
    },
  })

  const handleSubmit = (e) => {
    e.preventDefault()
    setError('')
    loginMutation.mutate(formData)
  }

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    })
  }

  return (
    <div className="auth-container">
      <form className="auth-form" onSubmit={handleSubmit}>
        <img src={Logo} alt="JB Calling Logo" className="auth-logo" />
        <h2>Đăng Nhập</h2>
        
        {error && <div className="error-message">{error}</div>}
        
        <div className="form-group">
          <label htmlFor="username">Tên đăng nhập</label>
          <input
            type="text"
            id="username"
            name="username"
            value={formData.username}
            onChange={handleChange}
            required
            autoComplete="username"
          />
        </div>

        <div className="form-group">
          <label htmlFor="password">Mật khẩu</label>
          <input
            type="password"
            id="password"
            name="password"
            value={formData.password}
            onChange={handleChange}
            required
            autoComplete="current-password"
          />
        </div>

        <button 
          type="submit" 
          className="btn-primary"
          disabled={loginMutation.isPending}
        >
          {loginMutation.isPending ? 'Đang đăng nhập...' : 'Đăng Nhập'}
        </button>

        <div className="auth-link">
          Chưa có tài khoản? <Link to="/register">Đăng ký ngay</Link>
        </div>
      </form>
    </div>
  )
}
