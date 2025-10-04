import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || '/api';

class AuthService {
  constructor() {
    this.api = axios.create({
      baseURL: API_BASE_URL,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    console.log('AuthService constructor - API_BASE_URL:', API_BASE_URL);
    
    // Add token to requests
    this.api.interceptors.request.use((config) => {
      const token = localStorage.getItem('token');
      console.log('Interceptor - Token:', token ? 'Found' : 'Not found');
      console.log('Interceptor - Request URL:', config.url);
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
        console.log('Interceptor - Added Authorization header');
      } else {
        console.log('Interceptor - No token available');
      }
      return config;
    });

    // Handle token expiration
    this.api.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          // Only logout if we have a token (avoid infinite loops)
          if (localStorage.getItem('token')) {
            this.logout();
            // Don't redirect automatically, let the app handle it
          }
        }
        return Promise.reject(error);
      }
    );
  }

  async login(email, password) {
    try {
      const response = await this.api.post('/auth/login', { email, password });
      const { token, user } = response.data;

      console.log('Login - Token received:', token ? 'Yes' : 'No');
      localStorage.setItem('token', token);
      console.log('Login - Token stored in localStorage');
      return user;
    } catch (error) {
      throw new Error(error.response?.data?.error || 'Login failed');
    }
  }

  async register(email, password) {
    try {
      const response = await this.api.post('/auth/register', { email, password });
      const { token, user } = response.data;

      localStorage.setItem('token', token);
      return user;
    } catch (error) {
      throw new Error(error.response?.data?.error || 'Registration failed');
    }
  }

  async getCurrentUser() {
    try {
      const response = await this.api.get('/auth/me');
      return response.data.user;
    } catch (error) {
      throw new Error('Not authenticated');
    }
  }

  logout() {
    localStorage.removeItem('token');
  }

  isAuthenticated() {
    return !!localStorage.getItem('token');
  }
}

export const authService = new AuthService();
console.log('AuthService instance created:', authService);