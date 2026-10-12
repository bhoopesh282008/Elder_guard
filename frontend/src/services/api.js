import axios from 'axios';
import tabStorage from '../utils/tabStorage';

// Dev uses the local backend; a production build is served by the backend itself (same origin).
export const API_BASE_URL =
  import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://127.0.0.1:8000' : '');

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request Interceptor: Attach JWT Bearer Token if logged in
api.interceptors.request.use(
  (config) => {
    const token = tabStorage.getItem('elderguard_access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response Interceptor: Handle 401 Unauthorized Session Expired
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const refreshToken = tabStorage.getItem('elderguard_refresh_token');

    if (
      error.response?.status === 401 &&
      refreshToken &&
      !originalRequest?._retry &&
      !originalRequest?.url?.includes('/auth/refresh-token')
    ) {
      originalRequest._retry = true;
      try {
        const refreshResponse = await axios.post(`${API_BASE_URL}/auth/refresh-token`, {
          refresh_token: refreshToken,
        });
        const accessToken = refreshResponse.data.access_token;
        tabStorage.setItem('elderguard_access_token', accessToken);
        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        return api(originalRequest);
      } catch (_) {
        // Fall through to clearing the expired session below.
      }
    }

    if (error.response?.status === 401) {
      tabStorage.removeItem('elderguard_access_token');
      tabStorage.removeItem('elderguard_refresh_token');
      tabStorage.removeItem('elderguard_user');
      window.dispatchEvent(new Event('elderguard:session-expired'));
    }
    return Promise.reject(error);
  }
);

export default api;
