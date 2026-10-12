import api, { API_BASE_URL } from './api';
import tabStorage from '../utils/tabStorage';

export const connectedPortalService = {
  async elderDashboard() {
    const response = await api.get('/api/elder/dashboard');
    return response.data;
  },

  async caregiverElders() {
    const response = await api.get('/api/caregiver/elders');
    return response.data;
  },

  async caregiverDashboard(elderId) {
    const response = await api.get(`/api/caregiver/elders/${elderId}/dashboard`);
    return response.data;
  },

  async caregiverVitals(elderId, range = '7d') {
    const response = await api.get(`/api/caregiver/elders/${elderId}/vitals?range=${range}`);
    return response.data;
  },

  async inviteElder(elderIdentifier, permissionLevel = 'full_access') {
    const response = await api.post('/api/caregiver/invite', {
      elder_identifier: elderIdentifier,
      permission_level: permissionLevel,
    });
    return response.data;
  },

  async acceptInvite(linkId, permissionLevel = null) {
    const response = await api.post(`/api/elder/invites/${linkId}/accept`, {
      permission_level: permissionLevel,
    });
    return response.data;
  },

  async notifications() {
    const response = await api.get('/api/notifications');
    return response.data;
  },

  async addMedicine(elderId, payload) {
    const response = await api.post(`/api/caregiver/elders/${elderId}/medicines`, payload);
    return response.data;
  },

  async markMedicineTaken(medicineId, scheduledTime = null) {
    const response = await api.post(`/api/elder/medicines/${medicineId}/mark-taken`, {
      scheduled_time: scheduledTime,
    });
    return response.data;
  },

  async sendMedicineReminder(elderId, medicineId) {
    const response = await api.post(`/api/caregiver/elders/${elderId}/medicines/${medicineId}/send-reminder`);
    return response.data;
  },

  async triggerSOS(location = null) {
    const response = await api.post('/api/elder/sos', { location });
    return response.data;
  },

  async checkIn(mood = 'calm', okStatus = true) {
    const response = await api.post('/api/elder/checkin', {
      mood,
      ok_status: okStatus,
    });
    return response.data;
  },

  async elderVitals(range = '7d') {
    const response = await api.get(`/api/elder/vitals?range=${range}`);
    return response.data;
  },

  async logElderVital(payload) {
    const response = await api.post('/api/elder/vitals', payload);
    return response.data;
  },
};

export function elderRoomUrl(elderId) {
  const token = tabStorage.getItem('elderguard_access_token');
  const base = (API_BASE_URL || window.location.origin).replace(/^http/, 'ws');
  return `${base}/ws/elder/${elderId}${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

export default connectedPortalService;
