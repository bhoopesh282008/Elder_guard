import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import connectedPortalService from '../../services/connectedPortalService';
import { useConnectedMutations } from '../../hooks/useConnectedPortal';

// Shown to an elder when a caregiver asks to connect. Nothing is shared until the elder accepts.
export default function PendingInvitesCard() {
  const queryClient = useQueryClient();
  const mutations = useConnectedMutations();
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');

  const invitesQuery = useQuery({
    queryKey: ['pending-invites'],
    queryFn: connectedPortalService.pendingInvites,
    refetchInterval: 8000,
  });
  const invites = Array.isArray(invitesQuery.data) ? invitesQuery.data : [];
  if (invites.length === 0) return null;

  const respond = async (invite, accept) => {
    setBusyId(invite.id);
    setError('');
    try {
      if (accept) {
        await mutations.acceptInvite.mutateAsync({ linkId: invite.id, permissionLevel: invite.permission_level });
      } else {
        await connectedPortalService.declineInvite(invite.id);
      }
      await queryClient.invalidateQueries({ queryKey: ['pending-invites'] });
    } catch (err) {
      setError(err.response?.data?.detail?.error?.message || 'Could not update this request. Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-3" data-testid="pending-invites">
      {invites.map((invite) => (
        <div key={invite.id} className="bg-[#FFF8E7] border-2 border-[#F5A623]/60 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-xl bg-[#F5A623]/20 text-[#B45309] shrink-0">
              <UserPlus className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-bold text-sm text-[#2E2E2E]">
                {invite.caregiver_name || invite.caregiver_email || 'A caregiver'} wants to connect
              </h4>
              <p className="text-xs text-[#525252] font-medium">
                {invite.relationship_to_elder ? `${invite.relationship_to_elder}. ` : ''}
                If you accept, they can see your medicines, vitals and SOS alerts
                {invite.permission_level === 'full_access' ? ' and manage your care plan' : ' (view only)'}.
              </p>
              {error && <p className="text-xs font-semibold text-[#C1443A] mt-1" role="alert">{error}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
            <button
              onClick={() => respond(invite, false)}
              disabled={busyId === invite.id}
              className="px-4 py-2 rounded-xl border border-[#E5E9F0] bg-white text-[#525252] font-bold text-xs hover:bg-[#FAFBFC] disabled:opacity-60 cursor-pointer"
            >
              Decline
            </button>
            <button
              onClick={() => respond(invite, true)}
              disabled={busyId === invite.id}
              className="px-4 py-2 rounded-xl bg-[#1F8A5F] text-white font-bold text-xs hover:bg-[#1F8A5F]/90 disabled:opacity-60 cursor-pointer"
            >
              Accept
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
