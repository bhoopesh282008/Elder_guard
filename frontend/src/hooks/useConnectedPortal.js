import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import connectedPortalService, { elderRoomUrl } from '../services/connectedPortalService';
import broadcastRealtimeEvent from '../utils/realtimeBus';

const elderEvents = [
  'medicine:taken',
  'medicine:added',
  'medicine:updated',
  'vital:logged',
  'sos:triggered',
  'sos:resolved',
  'sos:acknowledged',
  'sos:escalated',
  'link:invited',
  'link:accepted',
  'checkin:submitted',
  'appointment:booked',
  'appointment:updated',
  'message:new',
  'reminder:sent',
];

export function useElderDashboard(enabled = true) {
  return useQuery({
    queryKey: ['elder-dashboard'],
    queryFn: connectedPortalService.elderDashboard,
    enabled,
  });
}

export function useCaregiverElders(enabled = true) {
  return useQuery({
    queryKey: ['caregiver-elders'],
    queryFn: connectedPortalService.caregiverElders,
    enabled,
    refetchInterval: 10000,
  });
}

export function useCaregiverDashboard(elderId, enabled = true) {
  return useQuery({
    queryKey: ['caregiver-dashboard', elderId],
    queryFn: () => connectedPortalService.caregiverDashboard(elderId),
    enabled: enabled && Boolean(elderId),
  });
}

export function useCaregiverVitals(elderId, range = '7d', enabled = true) {
  return useQuery({
    queryKey: ['caregiver-vitals', elderId, range],
    queryFn: () => connectedPortalService.caregiverVitals(elderId, range),
    enabled: enabled && Boolean(elderId),
  });
}

export function useConnectedNotifications(enabled = true) {
  return useQuery({
    queryKey: ['connected-notifications'],
    queryFn: connectedPortalService.notifications,
    enabled,
  });
}

export function useConnectedMutations() {
  const queryClient = useQueryClient();
  const invalidateElder = (elderId) => {
    queryClient.invalidateQueries({ queryKey: ['elder-dashboard'] });
    queryClient.invalidateQueries({ queryKey: ['caregiver-elders'] });
    if (elderId) {
      queryClient.invalidateQueries({ queryKey: ['caregiver-dashboard', elderId] });
      queryClient.invalidateQueries({ queryKey: ['caregiver-vitals', elderId] });
    }
  };

  return {
    addMedicine: useMutation({
      mutationFn: ({ elderId, payload }) => connectedPortalService.addMedicine(elderId, payload),
      onSuccess: (_, vars) => invalidateElder(vars.elderId),
    }),
    markMedicineTaken: useMutation({
      mutationFn: ({ medicineId, scheduledTime }) => connectedPortalService.markMedicineTaken(medicineId, scheduledTime),
      onSuccess: (data) => invalidateElder(data?.elder_id),
    }),
    sendMedicineReminder: useMutation({
      mutationFn: ({ elderId, medicineId }) => connectedPortalService.sendMedicineReminder(elderId, medicineId),
      onSuccess: (_, vars) => invalidateElder(vars.elderId),
    }),
    triggerSOS: useMutation({
      mutationFn: ({ location }) => connectedPortalService.triggerSOS(location),
      onSuccess: (data) => invalidateElder(data?.elder_id),
    }),
    checkIn: useMutation({
      mutationFn: ({ mood, okStatus }) => connectedPortalService.checkIn(mood, okStatus),
      onSuccess: (data) => invalidateElder(data?.elder_id),
    }),
    inviteElder: useMutation({
      mutationFn: ({ elderIdentifier, permissionLevel }) => connectedPortalService.inviteElder(elderIdentifier, permissionLevel),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ['caregiver-elders'] }),
    }),
    acceptInvite: useMutation({
      mutationFn: ({ linkId, permissionLevel }) => connectedPortalService.acceptInvite(linkId, permissionLevel),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['connected-notifications'] });
        queryClient.invalidateQueries({ queryKey: ['elder-dashboard'] });
      },
    }),
  };
}

export function useElderRoom(elderId, enabled = true) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled || !elderId) return undefined;
    const ws = new WebSocket(elderRoomUrl(elderId));
    ws.onmessage = (message) => {
      try {
        const data = JSON.parse(message.data);
        if (!elderEvents.includes(data.event)) return;
        queryClient.invalidateQueries({ queryKey: ['elder-dashboard'] });
        queryClient.invalidateQueries({ queryKey: ['connected-notifications'] });
        queryClient.invalidateQueries({ queryKey: ['caregiver-elders'] });
        queryClient.invalidateQueries({ queryKey: ['caregiver-dashboard', elderId] });
        queryClient.invalidateQueries({ queryKey: ['caregiver-vitals', elderId] });
        broadcastRealtimeEvent('elderguard:realtime-event', data);
      } catch (_) {}
    };
    return () => ws.close();
  }, [elderId, enabled, queryClient]);
}
