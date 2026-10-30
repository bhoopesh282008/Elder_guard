import React, { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Send, CheckCircle2, Loader2 } from 'lucide-react';
import connectedPortalService from '../../services/connectedPortalService';
import api from '../../services/api';

// Lets a user link their Telegram so SOS, medicine and daily-summary alerts reach their phone.
export default function TelegramConnectCard() {
  const queryClient = useQueryClient();
  const [waiting, setWaiting] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const statusQuery = useQuery({
    queryKey: ['telegram-status'],
    queryFn: connectedPortalService.telegramStatus,
    // Poll while the user is in Telegram pressing Start, so the card flips to Connected by itself.
    refetchInterval: waiting ? 3000 : false,
  });
  const status = statusQuery.data;

  useEffect(() => {
    if (status?.linked && waiting) {
      setWaiting(false);
      setMessage('');
    }
  }, [status?.linked, waiting]);

  useEffect(() => {
    if (!waiting) return undefined;
    const stop = setTimeout(() => setWaiting(false), 3 * 60 * 1000);
    return () => clearTimeout(stop);
  }, [waiting]);

  const connect = async () => {
    setBusy(true);
    setMessage('');
    try {
      const { url } = await connectedPortalService.telegramLinkUrl();
      window.open(url, '_blank', 'noopener');
      setWaiting(true);
    } catch (error) {
      setMessage('Could not start linking. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    setBusy(true);
    try {
      const { data } = await api.post('/notifications/telegram/test');
      setMessage(data?.success ? 'Test alert sent. Check Telegram.' : 'Could not reach Telegram. Try again in a moment.');
    } catch (error) {
      setMessage('Could not reach Telegram. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await connectedPortalService.telegramUnlink();
      await queryClient.invalidateQueries({ queryKey: ['telegram-status'] });
      setMessage('');
    } finally {
      setBusy(false);
    }
  };

  if (statusQuery.isLoading) return null;
  const linked = Boolean(status?.linked);

  return (
    <div className="bg-white border border-[#E5E9F0] rounded-2xl p-4 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3" data-testid="telegram-card">
      <div className="flex items-start gap-3">
        <div className={`p-2.5 rounded-xl shrink-0 ${linked ? 'bg-[#1F8A5F]/15 text-[#1F8A5F]' : 'bg-[#229ED9]/15 text-[#229ED9]'}`}>
          {linked ? <CheckCircle2 className="w-5 h-5" /> : <Send className="w-5 h-5" />}
        </div>
        <div>
          <h4 className="font-bold text-sm text-[#1A1D23]">
            {linked ? 'Telegram alerts connected' : 'Get alerts on Telegram'}
          </h4>
          <p className="text-xs text-[#6B7280] font-medium">
            {linked
              ? `SOS, medicine and daily-summary alerts go to ${status.telegram_username ? '@' + status.telegram_username : 'your Telegram'}. Reply /status in the bot any time.`
              : status?.bot_configured === false
                ? 'The Telegram bot is not configured on this server yet.'
                : waiting
                  ? 'Waiting for you to press Start in Telegram...'
                  : 'Receive SOS and medicine alerts on your phone, and tap "I\'m on my way" to respond.'}
          </p>
          {message && <p className="text-xs font-semibold text-[#3B4C9E] mt-1" role="status">{message}</p>}
        </div>
      </div>
      <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
        {linked ? (
          <>
            <button onClick={sendTest} disabled={busy} className="px-3.5 py-2 rounded-xl bg-[#3B4C9E] text-white font-bold text-xs hover:bg-[#3B4C9E]/90 disabled:opacity-60 cursor-pointer">
              Send test alert
            </button>
            <button onClick={disconnect} disabled={busy} className="px-3.5 py-2 rounded-xl border border-[#E5E9F0] text-[#6B7280] font-bold text-xs hover:bg-[#FAFBFC] disabled:opacity-60 cursor-pointer">
              Disconnect
            </button>
          </>
        ) : (
          status?.bot_configured !== false && (
            <button onClick={connect} disabled={busy || waiting} className="px-4 py-2 rounded-xl bg-[#229ED9] text-white font-bold text-xs hover:bg-[#229ED9]/90 disabled:opacity-70 inline-flex items-center gap-2 cursor-pointer">
              {(busy || waiting) && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {waiting ? 'Waiting...' : 'Connect Telegram'}
            </button>
          )
        )}
      </div>
    </div>
  );
}
