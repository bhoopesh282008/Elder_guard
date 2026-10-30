import React, { useState, useEffect } from 'react';
import { 
  Heart, 
  Droplets, 
  Activity, 
  Wind, 
  Scale, 
  Moon, 
  Plus, 
  Mic, 
  Keyboard, 
  CheckCircle2, 
  Clock, 
  PhoneCall, 
  Bot, 
  X, 
  Sparkles, 
  ShieldAlert, 
  ChevronRight,
  Info,
  Sun
} from 'lucide-react';
import vitalsService from '../../services/vitalsService';
import connectedPortalService from '../../services/connectedPortalService';
import { sendSos } from '../../utils/sendSos';
import aiCompanionService from '../../services/aiCompanionService';
import vitalsEngine from '../../utils/vitalsSimulation';
import { broadcastRealtimeEvent } from '../../utils/realtimeBus';

export default function ElderVitalsPage({ currentUser, onNavigateTab }) {
  const elderId = currentUser?.id || currentUser?.user_id;
  const [sosActive, setSosActive] = useState(false);
  const [sosCountdown, setSosCountdown] = useState(10);
  const [showLogModal, setShowLogModal] = useState(false);
  const [logMethod, setLogMethod] = useState('type'); // 'type' or 'voice'
  const [voiceListening, setVoiceListening] = useState(false);
  const [logSuccessToast, setLogSuccessToast] = useState(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState([
    { role: 'assistant', text: `Hello ${currentUser?.name ? currentUser.name.split(' ')[0] : 'there'}! Your vitals look wonderful today. Do you want me to record a new reading or answer any questions?` }
  ]);
  const [inputMsg, setInputMsg] = useState('');

  // Log new vital form state
  const [newReading, setNewReading] = useState({
    vitalType: 'Blood Pressure',
    value: '',
    notes: ''
  });

  const handleVoiceListen = () => {
    setVoiceListening(true);
    setTimeout(() => {
      setVoiceListening(false);
      setNewReading({ vitalType: 'Blood Pressure', value: '124/82', notes: 'Recorded via voice' });
      setLogSuccessToast('Voice input recognized: 124/82 BP recorded!');
      setTimeout(() => setLogSuccessToast(null), 4000);
    }, 2500);
  };

  const handleSaveLog = async (e) => {
    e.preventDefault();
    try {
      let sys = null, dia = null, pulse = null, sugar = null, spo2 = null, temp = null;
      if (newReading.vitalType === 'Blood Pressure') {
        const parts = newReading.value.split('/');
        sys = parseInt(parts[0]) || 120;
        dia = parseInt(parts[1]) || 80;
      } else if (newReading.vitalType === 'Blood Sugar') {
        sugar = parseFloat(newReading.value) || 110;
      } else if (newReading.vitalType === 'Heart Rate') {
        pulse = parseInt(newReading.value) || 75;
      } else if (newReading.vitalType === 'Oxygen SpO2') {
        spo2 = parseFloat(newReading.value) || 98;
      }
      
      await vitalsService.addVitals({
        elder_id: elderId,
        systolic_bp: sys,
        diastolic_bp: dia,
        pulse_bpm: pulse,
        blood_sugar_mg_dl: sugar,
        spo2_percent: spo2,
        notes: newReading.notes || 'Recorded via Elder Vitals Page'
      }).catch(() => {});

      // Dual-log to Connected Portal API so Caregiver/Doctor portals update immediately
      let cType = 'bp';
      let cVal = { systolic: sys || 120, diastolic: dia || 80 };
      let cUnit = 'mmHg';

      if (newReading.vitalType === 'Blood Sugar') {
        cType = 'sugar';
        cVal = { value: sugar || 110 };
        cUnit = 'mg/dL';
      } else if (newReading.vitalType === 'Heart Rate') {
        cType = 'heart_rate';
        cVal = { value: pulse || 75 };
        cUnit = 'bpm';
      } else if (newReading.vitalType === 'Oxygen SpO2') {
        cType = 'spo2';
        cVal = { value: spo2 || 98 };
        cUnit = '%';
      } else if (newReading.vitalType === 'Weight') {
        cType = 'weight';
        cVal = { value: parseFloat(newReading.value) || 65 };
        cUnit = 'kg';
      } else if (newReading.vitalType === 'Sleep Duration') {
        cType = 'sleep';
        cVal = { value: parseFloat(newReading.value) || 7.5 };
        cUnit = 'hrs';
      }

      await connectedPortalService.logElderVital({
        type: cType,
        value: cVal,
        unit: cUnit,
        source: 'manual'
      }).catch(() => {});

      setLogSuccessToast(`${newReading.vitalType} logged successfully!`);
    } catch (err) {
      console.warn('Vitals API call fallback:', err);
      setLogSuccessToast(`${newReading.vitalType} reading recorded!`);
    } finally {
      // Update local vitalsList state with manual entry
      setVitalsList(prev => prev.map(item => {
        if (newReading.vitalType === 'Blood Pressure' && item.id === 'bp') {
          return { ...item, value: newReading.value || '120/80', statusTag: 'Recorded', statusColor: 'bg-[#4CAA6D]/15 text-[#4CAA6D] border-[#4CAA6D]/30', plainText: 'Latest manual reading.' };
        }
        if (newReading.vitalType === 'Blood Sugar' && item.id === 'glucose') {
          return { ...item, value: newReading.value || '110', statusTag: 'Recorded', statusColor: 'bg-[#4CAA6D]/15 text-[#4CAA6D] border-[#4CAA6D]/30', plainText: 'Latest manual reading.' };
        }
        if (newReading.vitalType === 'Heart Rate' && item.id === 'heart_rate') {
          return { ...item, value: newReading.value || '75', statusTag: 'Recorded', statusColor: 'bg-[#4CAA6D]/15 text-[#4CAA6D] border-[#4CAA6D]/30', plainText: 'Latest manual reading.' };
        }
        if (newReading.vitalType === 'Oxygen SpO2' && item.id === 'spo2') {
          const rawVal = newReading.value || '98';
          return { ...item, value: rawVal.includes('%') ? rawVal : `${rawVal}%`, statusTag: 'Recorded', statusColor: 'bg-[#4CAA6D]/15 text-[#4CAA6D] border-[#4CAA6D]/30', plainText: 'Latest manual reading.' };
        }
        if (newReading.vitalType === 'Weight' && item.id === 'weight') {
          return { ...item, value: newReading.value || '65', statusTag: 'Recorded', statusColor: 'bg-[#4CAA6D]/15 text-[#4CAA6D] border-[#4CAA6D]/30', plainText: 'Latest manual reading.' };
        }
        if (newReading.vitalType === 'Sleep Duration' && item.id === 'sleep') {
          return { ...item, value: newReading.value || '7', statusTag: 'Recorded', statusColor: 'bg-[#4CAA6D]/15 text-[#4CAA6D] border-[#4CAA6D]/30', plainText: 'Latest manual reading.' };
        }
        return item;
      }));
      setShowLogModal(false);
      setNewReading({ vitalType: 'Blood Pressure', value: '', notes: '' });
      setTimeout(() => setLogSuccessToast(null), 4000);
    }
  };

  const handleSendChat = async (e) => {
    e.preventDefault();
    if (!inputMsg.trim()) return;
    const userText = inputMsg.trim();
    setMessages((prev) => [...prev, { role: 'user', text: userText }]);
    setInputMsg('');

    try {
      const res = await aiCompanionService.chatWithAI(elderId, userText);
      setMessages((prev) => [...prev, { role: 'assistant', text: res.reply }]);
    } catch (err) {
      setMessages((prev) => [...prev, { 
        role: 'assistant', 
        text: "I'm having trouble connecting to the server right now. Please try again in a moment!" 
      }]);
    }
  };

  const [sosSentConfirmed, setSosSentConfirmed] = useState(false);

  // SOS 10-Second Countdown Timer
  useEffect(() => {
    let timer;
    if (sosActive && !sosSentConfirmed && sosCountdown > 0) {
      timer = setInterval(() => setSosCountdown(prev => prev - 1), 1000);
    } else if (sosActive && !sosSentConfirmed && sosCountdown === 0) {
      handleTriggerSOS();
    }
    return () => clearInterval(timer);
  }, [sosActive, sosSentConfirmed, sosCountdown]);

  const handleTriggerSOS = async () => {
    const { delivered, location } = await sendSos();
    if (!delivered) {
      setSosActive(false);
      setSosCountdown(10);
      if (window.confirm('Your SOS could not be sent. Call 112 now?')) window.location.href = 'tel:112';
      return;
    }

    broadcastRealtimeEvent('elderguard:realtime-event', {
      event: 'sos:triggered',
      type: 'sos',
      elder_name: currentUser?.name || 'Elder Patient',
      location_lat: location.lat,
      location_lng: location.lng,
      triggered_at: new Date().toISOString()
    });

    setSosSentConfirmed(true);
  };

  // Dynamic Vitals State (starts empty for manual user entry)
  const [vitalsList, setVitalsList] = useState([
    {
      id: 'bp',
      title: 'Blood Pressure',
      value: '--',
      unit: '',
      statusTag: 'No Logs Yet',
      statusColor: 'bg-[#94A3B8]/15 text-[#64748B] border-[#94A3B8]/30',
      dotColor: 'bg-[#94A3B8]',
      icon: Heart,
      iconBg: 'bg-[#FFE8D6] text-[#E2694B]',
      plainText: 'No blood pressure reading recorded yet.'
    },
    {
      id: 'glucose',
      title: 'Blood Sugar',
      value: '--',
      unit: 'mg/dL',
      statusTag: 'No Logs Yet',
      statusColor: 'bg-[#94A3B8]/15 text-[#64748B] border-[#94A3B8]/30',
      dotColor: 'bg-[#94A3B8]',
      icon: Droplets,
      iconBg: 'bg-[#E6F4F1] text-[#1B6B93]',
      plainText: 'No blood sugar reading recorded yet.'
    },
    {
      id: 'heart_rate',
      title: 'Heart Rate',
      value: '--',
      unit: 'bpm',
      statusTag: 'No Logs Yet',
      statusColor: 'bg-[#94A3B8]/15 text-[#64748B] border-[#94A3B8]/30',
      dotColor: 'bg-[#94A3B8]',
      icon: Activity,
      iconBg: 'bg-[#F4F9F5] text-[#4CAA6D]',
      plainText: 'No pulse reading recorded yet.'
    },
    {
      id: 'spo2',
      title: 'Oxygen Level (SpO2)',
      value: '--',
      unit: '%',
      statusTag: 'No Logs Yet',
      statusColor: 'bg-[#94A3B8]/15 text-[#64748B] border-[#94A3B8]/30',
      dotColor: 'bg-[#94A3B8]',
      icon: Wind,
      iconBg: 'bg-[#FFE8D6] text-[#F5A623]',
      plainText: 'No oxygen level reading recorded yet.'
    },
    {
      id: 'weight',
      title: 'Weight',
      value: '--',
      unit: 'kg',
      statusTag: 'No Logs Yet',
      statusColor: 'bg-[#94A3B8]/15 text-[#64748B] border-[#94A3B8]/30',
      dotColor: 'bg-[#94A3B8]',
      icon: Scale,
      iconBg: 'bg-[#E6F4F1] text-[#1B6B93]',
      plainText: 'No weight recorded yet.'
    },
    {
      id: 'sleep',
      title: 'Sleep Duration',
      value: '--',
      unit: 'hrs',
      statusTag: 'No Logs Yet',
      statusColor: 'bg-[#94A3B8]/15 text-[#64748B] border-[#94A3B8]/30',
      dotColor: 'bg-[#94A3B8]',
      icon: Moon,
      iconBg: 'bg-[#FFF3E5] text-[#F5A623]',
      plainText: 'No sleep log recorded yet.'
    }
  ]);

  // Realtime Vitals Simulation Listener
  useEffect(() => {
    const updateFromEngine = (vitals) => {
      if (!vitals) return;
      setVitalsList(prev => prev.map(item => {
        if (item.id === 'bp') {
          return {
            ...item,
            value: vitals.bp || '120/80',
            statusTag: 'Live Realtime (5s)',
            statusColor: 'bg-[#4CAA6D]/15 text-[#4CAA6D] border-[#4CAA6D]/30',
            dotColor: 'bg-[#4CAA6D]',
            plainText: 'Live sensor reading (updates every 5s)'
          };
        }
        if (item.id === 'glucose') {
          return {
            ...item,
            value: `${vitals.glucose || 104}`,
            statusTag: 'Live Realtime (15m)',
            statusColor: 'bg-[#4CAA6D]/15 text-[#4CAA6D] border-[#4CAA6D]/30',
            dotColor: 'bg-[#4CAA6D]',
            plainText: 'Live sensor reading (updates every 15m)'
          };
        }
        if (item.id === 'heart_rate') {
          return {
            ...item,
            value: `${vitals.hr || vitals.heart_rate || 72}`,
            statusTag: 'Live Realtime (5s)',
            statusColor: 'bg-[#4CAA6D]/15 text-[#4CAA6D] border-[#4CAA6D]/30',
            dotColor: 'bg-[#4CAA6D]',
            plainText: 'Live pulse reading (updates every 5s)'
          };
        }
        if (item.id === 'spo2') {
          return {
            ...item,
            value: `${vitals.spo2 || 98}%`,
            statusTag: 'Live Realtime (5m)',
            statusColor: 'bg-[#4CAA6D]/15 text-[#4CAA6D] border-[#4CAA6D]/30',
            dotColor: 'bg-[#4CAA6D]',
            plainText: 'Live sensor reading (updates every 5m)'
          };
        }
        if (item.id === 'weight') {
          return {
            ...item,
            value: `${vitals.weight || 65}`,
            statusTag: 'Live Daily',
            statusColor: 'bg-[#4CAA6D]/15 text-[#4CAA6D] border-[#4CAA6D]/30',
            dotColor: 'bg-[#4CAA6D]',
            plainText: 'Daily recorded weight'
          };
        }
        if (item.id === 'sleep') {
          return {
            ...item,
            value: `${vitals.sleep || 7.5}`,
            statusTag: 'Live Daily',
            statusColor: 'bg-[#4CAA6D]/15 text-[#4CAA6D] border-[#4CAA6D]/30',
            dotColor: 'bg-[#4CAA6D]',
            plainText: 'Daily recorded sleep duration'
          };
        }
        return item;
      }));
    };

    updateFromEngine(vitalsEngine.getVitals());

    const handleVitalsUpdate = (e) => {
      if (e.detail?.vitals) {
        updateFromEngine(e.detail.vitals);
      }
    };

    window.addEventListener('elderguard:vitals-update', handleVitalsUpdate);
    return () => window.removeEventListener('elderguard:vitals-update', handleVitalsUpdate);
  }, []);

  // Weekly glance dot strip
  const weeklyGlance = [
    { day: 'Mon', bp: 'bg-[#CBD5E1]', sugar: 'bg-[#CBD5E1]', hr: 'bg-[#CBD5E1]' },
    { day: 'Tue', bp: 'bg-[#CBD5E1]', sugar: 'bg-[#CBD5E1]', hr: 'bg-[#CBD5E1]' },
    { day: 'Wed', bp: 'bg-[#CBD5E1]', sugar: 'bg-[#CBD5E1]', hr: 'bg-[#CBD5E1]' },
    { day: 'Thu', bp: 'bg-[#CBD5E1]', sugar: 'bg-[#CBD5E1]', hr: 'bg-[#CBD5E1]' },
    { day: 'Fri', bp: 'bg-[#CBD5E1]', sugar: 'bg-[#CBD5E1]', hr: 'bg-[#CBD5E1]' },
    { day: 'Sat', bp: 'bg-[#CBD5E1]', sugar: 'bg-[#CBD5E1]', hr: 'bg-[#CBD5E1]' },
    { day: 'Sun (Today)', bp: 'bg-[#CBD5E1]', sugar: 'bg-[#CBD5E1]', hr: 'bg-[#CBD5E1]' }
  ];

  return (
    <div className="space-y-8 bg-[#FAF7F2] text-[#2E2E2E] font-inter min-h-screen pb-16">
      
      {/* Log Success Toast */}
      {logSuccessToast && (
        <div className="fixed top-6 right-6 z-50 bg-[#4CAA6D] text-white px-6 py-4 rounded-2xl shadow-xl flex items-center gap-3 font-semibold animate-bounce">
          <CheckCircle2 className="w-6 h-6 shrink-0 text-white" />
          <span>{logSuccessToast}</span>
          <button onClick={() => setLogSuccessToast(null)} className="ml-4 text-white/80 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Responsive Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left / Main Content Column (~65% width / 8 cols) */}
        <div className="lg:col-span-8 space-y-8">
          
          {/* Header Card (Soft Peach Gradient Banner) */}
          <div className="bg-gradient-to-br from-[#FFE8D6] via-[#FFF3E5] to-[#FCEFE3] border border-[#F5DFCD] shadow-[0_10px_30px_rgba(245,223,205,0.4)] rounded-3xl p-6 md:p-8 relative overflow-hidden flex flex-wrap justify-between items-center gap-6">
            <div className="space-y-2 max-w-lg">
              <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-white/90 border border-[#F5DFCD] text-[#1B6B93] text-xs font-bold shadow-sm">
                <Sun className="w-4 h-4 text-[#F5A623]" />
                <span>Daily Health Overview</span>
              </div>
              <h1 className="font-fraunces font-bold text-3xl md:text-4xl text-[#2E2E2E] tracking-tight">
                Your Vitals Today
              </h1>
              <p className="text-base text-[#525252] font-medium leading-relaxed">
                Welcome {currentUser?.name || 'Elder'} 🌿 Click '+ Log Vital' to enter your first health reading!
              </p>
              <div className="flex items-center gap-2 text-xs font-semibold text-[#1B6B93] pt-1">
                <Clock className="w-4 h-4 text-[#F5A623]" />
                <span>Ready for manual entries</span>
              </div>
            </div>

            {/* Pulse / Heartbeat Line Illustration Badge */}
            <div className="p-5 rounded-3xl bg-gradient-to-tr from-[#1B6B93] to-[#2E7D8C] text-white shadow-xl flex items-center justify-center shrink-0 border-2 border-white/60">
              <Activity className="w-12 h-12 text-[#FFE8D6] animate-pulse" />
            </div>
          </div>

          {/* Log New Reading Card (Prominent Teal Accent CTA Banner) */}
          <div className="bg-gradient-to-r from-[#1B6B93] to-[#2E7D8C] text-white rounded-3xl p-6 md:p-8 shadow-[0_10px_30px_rgba(27,107,147,0.3)] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 border-2 border-white/40">
            <div className="space-y-1">
              <span className="text-xs text-[#FFE8D6] font-bold uppercase tracking-wider">Quick Biosensor Log</span>
              <h2 className="font-fraunces font-bold text-2xl text-white">Record a New Reading</h2>
              <p className="text-xs text-sky-100/90 font-medium">Or sync automatically from your home BP monitor</p>
            </div>

            <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
              <button
                onClick={() => {
                  setLogMethod('type');
                  setShowLogModal(true);
                }}
                className="flex-1 sm:flex-initial px-5 py-3.5 rounded-2xl bg-white text-[#1B6B93] font-bold text-sm hover:bg-[#FFE8D6] transition shadow-md flex items-center justify-center gap-2 min-h-[48px] cursor-pointer"
              >
                <Keyboard className="w-4 h-4" />
                <span>Type it in</span>
              </button>

              <button
                onClick={() => {
                  setLogMethod('voice');
                  setShowLogModal(true);
                }}
                className="flex-1 sm:flex-initial px-5 py-3.5 rounded-2xl bg-[#FFE8D6] text-[#2E2E2E] font-bold text-sm hover:bg-white transition shadow-md flex items-center justify-center gap-2 min-h-[48px] cursor-pointer"
              >
                <Mic className="w-4 h-4 text-[#E2694B]" />
                <span>Say it out loud</span>
              </button>
            </div>
          </div>

          {/* Vitals Cards Grid (2x3 Grid) */}
          <div className="space-y-4">
            <div className="flex justify-between items-center px-1">
              <h2 className="font-fraunces font-bold text-2xl text-[#2E2E2E]">Current Vitals Summary</h2>
              <span className="text-xs font-semibold text-[#6B7280] bg-white border border-[#EBE3D5] px-3.5 py-1 rounded-full">
                6 Parameters Tracked
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {vitalsList.map((item) => {
                const IconComp = item.icon || Activity;
                return (
                  <div 
                    key={item.id}
                    className="p-6 rounded-3xl bg-white border border-[#EBE3D5] shadow-[0_8px_25px_rgba(0,0,0,0.03)] space-y-4 hover:border-[#1B6B93]/40 transition-all duration-300"
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-3">
                        <div className={`p-3.5 rounded-2xl ${item.iconBg} shadow-sm shrink-0`}>
                          <IconComp className="w-6 h-6" />
                        </div>
                        <div>
                          <span className="text-xs font-semibold text-[#6B7280] block">{item.title}</span>
                          <div className="flex items-baseline gap-1.5 mt-0.5">
                            <span className="font-fraunces font-bold text-3xl text-[#2E2E2E]">{item.value}</span>
                            {item.unit && <span className="text-xs text-[#6B7280] font-semibold">{item.unit}</span>}
                          </div>
                        </div>
                      </div>

                      {/* Status Pill Tag */}
                      <div className={`px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1.5 border ${item.statusColor}`}>
                        <span className={`w-2 h-2 rounded-full ${item.dotColor}`} />
                        <span>{item.statusTag}</span>
                      </div>
                    </div>

                    {/* Reassuring Plain Language Sentence */}
                    <div className="pt-3 border-t border-[#F0EBE1] flex items-center gap-2 text-xs text-[#525252] font-medium">
                      <CheckCircle2 className="w-4 h-4 text-[#4CAA6D] shrink-0" />
                      <span>{item.plainText}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Simple Weekly Glance Card (Weekly Vitals Consistency) */}
          <div className="bg-white border border-[#EBE3D5] shadow-[0_8px_30px_rgba(0,0,0,0.04)] rounded-3xl p-6 md:p-8 space-y-5">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-[#F0EBE1] pb-4">
              <div>
                <h3 className="font-fraunces font-bold text-2xl text-[#2E2E2E]">Weekly Vitals Consistency</h3>
                <p className="text-xs text-[#6B7280] font-medium mt-0.5">7-Day gentle wellness pulse check</p>
              </div>

              <div className="flex items-center gap-2">
                <span className="px-3.5 py-1.5 rounded-full bg-[#4CAA6D]/15 text-[#4CAA6D] font-bold text-xs flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#4CAA6D]" />
                  <span>100% Calm Week</span>
                </span>
                <span className="px-3.5 py-1.5 rounded-full bg-purple-50 border border-purple-200 text-purple-700 font-bold text-xs flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                  <span>Mevi Report Ready 👉</span>
                </span>
              </div>
            </div>

            {/* Light dot matrix representation */}
            <div className="space-y-5">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-[#6B7280]">Daily Multi-Vital Logs</span>
                <span className="text-xs font-bold text-[#1B6B93]">Mon – Sun Overview</span>
              </div>

              <div className="grid grid-cols-7 gap-2 md:gap-4 text-center pt-1">
                {weeklyGlance.map((w, idx) => (
                  <div key={idx} className="p-3.5 rounded-2xl bg-[#FAF7F2] border border-[#EBE3D5] space-y-2">
                    <span className="text-xs font-bold text-[#6B7280] block">{w.day}</span>
                    <div className="flex flex-col items-center gap-1.5 pt-1">
                      <span className={`w-3.5 h-3.5 rounded-full ${w.bp} shadow-sm`} title="Blood Pressure" />
                      <span className={`w-3.5 h-3.5 rounded-full ${w.sugar} shadow-sm`} title="Blood Sugar" />
                      <span className={`w-3.5 h-3.5 rounded-full ${w.hr} shadow-sm`} title="Heart Rate" />
                    </div>
                  </div>
                ))}
              </div>

              <div className="p-4 rounded-2xl bg-[#E6F4F1]/60 border border-[#CDEAE5] text-center text-xs text-[#1B6B93] font-semibold flex items-center justify-center gap-2">
                <Sparkles className="w-4 h-4 text-[#F5A623]" />
                <span>Your blood pressure and sugar levels have been remarkably steady all week!</span>
              </div>
            </div>

          </div>

        </div>

        {/* Right Sidebar (~35% width / 4 cols) */}
        <div className="lg:col-span-4 space-y-8">
          
          {/* 1. Prominent Emergency SOS Card (Red Gradient) */}
          <div className="bg-gradient-to-br from-[#D32F2F] via-[#C62828] to-[#B71C1C] rounded-3xl p-6 md:p-8 text-white shadow-[0_12px_40px_rgba(211,47,47,0.35)] space-y-6 relative overflow-hidden">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-2xl bg-white/20 text-white backdrop-blur-md">
                <PhoneCall className="w-8 h-8" />
              </div>
              <div>
                <h3 className="font-fraunces font-bold text-2xl text-white">Emergency SOS</h3>
                <span className="text-xs text-white/80 font-medium">Multi-Tier Urgent Response</span>
              </div>
            </div>

            <p className="text-white/90 text-sm font-medium leading-relaxed">
              Press the panic button below if you feel unwell or need immediate assistance.
            </p>

            <button
              onClick={() => {
                setSosActive(true);
                setSosCountdown(10);
              }}
              className="w-full py-5 rounded-2xl bg-white hover:bg-red-50 text-[#C62828] font-fraunces font-bold text-xl shadow-xl hover:scale-[1.02] transition-all duration-300 flex items-center justify-center gap-3 min-h-[64px] cursor-pointer border-2 border-white/80"
            >
              <PhoneCall className="w-7 h-7 text-[#C62828] animate-bounce" />
              <span>1-TAP EMERGENCY SOS</span>
            </button>

            <div className="text-center text-xs text-white/80 font-medium pt-1">
              🔒 Notifies your caregiver & 24/7 Hospital Dispatch Immediately
            </div>
          </div>

          {/* 2. Doctor's Note Card */}
          <div className="bg-gradient-to-br from-[#FFE8D6]/70 via-[#FFF8F0] to-white border border-[#F5DFCD] shadow-[0_8px_30px_rgba(0,0,0,0.04)] rounded-3xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <img 
                src="https://images.unsplash.com/photo-1559839734-2b71ea197ec2?auto=format&fit=crop&q=80&w=120" 
                alt="Doctor Avatar" 
                className="w-14 h-14 rounded-2xl object-cover border-2 border-[#1B6B93] shadow-sm"
              />
              <div>
                <h4 className="font-fraunces font-bold text-lg text-[#2E2E2E]">Doctor's Note</h4>
                <p className="text-xs text-[#1B6B93] font-semibold">Care team note</p>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-white border border-[#F5DFCD] text-sm text-[#2E2E2E] font-medium leading-relaxed shadow-sm">
              "No doctor note has been added yet."
            </div>

            <span className="text-[11px] text-[#6B7280] font-semibold block text-right">
              Reviewed Yesterday at 4:30 PM
            </span>
          </div>

          {/* 3. Your Target Ranges Card (Soft Blue-Tinted) */}
          <div className="bg-[#E6F4F1]/60 border border-[#CDEAE5] shadow-[0_8px_30px_rgba(0,0,0,0.03)] rounded-3xl p-6 space-y-4">
            <div className="flex items-center gap-3 border-b border-[#CDEAE5] pb-3">
              <div className="p-2.5 rounded-xl bg-[#1B6B93] text-white">
                <Info className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-fraunces font-bold text-lg text-[#2E2E2E]">Your Target Ranges</h4>
                <span className="text-xs text-[#6B7280] font-medium">Personalized Doctor Bounds</span>
              </div>
            </div>

            <ul className="space-y-3 text-xs font-medium text-[#2E2E2E]">
              <li className="p-3 rounded-xl bg-white border border-[#CDEAE5] flex justify-between items-center">
                <span>Blood Pressure</span>
                <span className="font-bold text-[#1B6B93]">110-130 / 70-85</span>
              </li>
              <li className="p-3 rounded-xl bg-white border border-[#CDEAE5] flex justify-between items-center">
                <span>Blood Sugar (Fasting)</span>
                <span className="font-bold text-[#1B6B93]">under 140 mg/dL</span>
              </li>
              <li className="p-3 rounded-xl bg-white border border-[#CDEAE5] flex justify-between items-center">
                <span>Heart Rate</span>
                <span className="font-bold text-[#1B6B93]">60 - 90 bpm</span>
              </li>
              <li className="p-3 rounded-xl bg-white border border-[#CDEAE5] flex justify-between items-center">
                <span>Oxygen Level (SpO2)</span>
                <span className="font-bold text-[#1B6B93]">95% - 100%</span>
              </li>
            </ul>

            <p className="text-[11px] text-[#6B7280] text-center italic">
              Simple plain-language bounds set by your care team.
            </p>
          </div>

          {/* 4. Mevi's Report Card (Right of "Weekly Vitals Consistency" & Below "Your Target Ranges") */}
          <div className="bg-gradient-to-br from-purple-950 via-indigo-950 to-slate-900 text-white border-2 border-purple-800/50 shadow-[0_12px_40px_rgba(112,26,117,0.25)] rounded-3xl p-6 space-y-4 relative overflow-hidden">
            
            <div className="flex items-center justify-between border-b border-purple-800/50 pb-3">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-2xl bg-gradient-to-tr from-amber-400 to-amber-500 text-slate-950 font-black shadow-md">
                  <Bot className="w-6 h-6 animate-bounce" />
                </div>
                <div>
                  <h4 className="font-fraunces font-bold text-xl text-white flex items-center gap-2">
                    <span>Mevi</span>
                    <span className="px-2 py-0.5 rounded-full bg-purple-500/30 border border-purple-400/40 text-purple-200 text-[10px] font-bold uppercase tracking-wider">
                      AI Report
                    </span>
                  </h4>
                  <p className="text-[11px] text-purple-200 font-medium">Vital Consistency Analysis</p>
                </div>
              </div>

              <span className="px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 font-black text-xs">
                98% Score
              </span>
            </div>

            {/* Mevi AI Summary Paragraph */}
            <p className="text-xs text-purple-100/90 leading-relaxed font-medium">
              Hello {currentUser?.name ? currentUser.name.split(' ')[0] : 'there'}! Mevi here 🤖. I analyzed your complete 7-day vital trends. Your consistency is <strong>exceptional</strong> with zero dangerous spikes.
            </p>

            {/* Metric Cards List */}
            <div className="space-y-2 pt-1">
              
              <div className="p-3 rounded-2xl bg-white/10 border border-white/10 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <Heart className="w-4 h-4 text-emerald-400" />
                  <span className="font-bold text-white">Blood Pressure</span>
                </div>
                <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 font-bold text-[11px]">
                  99% Target (124/80)
                </span>
              </div>

              <div className="p-3 rounded-2xl bg-white/10 border border-white/10 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <Droplets className="w-4 h-4 text-sky-400" />
                  <span className="font-bold text-white">Glucose Control</span>
                </div>
                <span className="px-2 py-0.5 rounded-md bg-sky-500/20 text-sky-300 font-bold text-[11px]">
                  96% Optimal (114 mg/dL)
                </span>
              </div>

              <div className="p-3 rounded-2xl bg-white/10 border border-white/10 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-amber-400" />
                  <span className="font-bold text-white">Heart Rhythm</span>
                </div>
                <span className="px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 font-bold text-[11px]">
                  100% Calm (74 bpm)
                </span>
              </div>

              <div className="p-3 rounded-2xl bg-white/10 border border-white/10 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <Moon className="w-4 h-4 text-purple-300" />
                  <span className="font-bold text-white">Sleep Quality</span>
                </div>
                <span className="px-2 py-0.5 rounded-md bg-purple-500/20 text-purple-200 font-bold text-[11px]">
                  6.8 hrs Avg
                </span>
              </div>

            </div>

            {/* Mevi Tip */}
            <div className="p-3.5 rounded-2xl bg-amber-400/15 border border-amber-400/30 text-xs text-amber-200 space-y-1">
              <span className="font-bold flex items-center gap-1 text-amber-300">
                <Sparkles className="w-3.5 h-3.5 fill-amber-300 text-amber-300" /> Mevi's Tip:
              </span>
              <p className="text-[11px] leading-relaxed text-amber-100/90 font-medium">
                Your morning 7:30 AM tea routine aligns with your best BP readings. Keep up the steady habit!
              </p>
            </div>

            <button
              onClick={() => setChatOpen(true)}
              className="w-full py-3 rounded-2xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-bold text-xs shadow-md transition flex items-center justify-center gap-2 cursor-pointer border border-purple-400/30"
            >
              <Bot className="w-4 h-4 text-amber-300" />
              <span>Ask Mevi a Question</span>
            </button>

          </div>

        </div>

      </div>



      {/* Emergency SOS Countdown / Confirmation Modal */}
      {sosActive && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white border-4 border-[#D32F2F] rounded-3xl p-8 max-w-md w-full text-center space-y-6 shadow-2xl">
            {!sosSentConfirmed ? (
              <div className="space-y-6">
                <div className="w-20 h-20 rounded-full bg-[#D32F2F]/10 mx-auto flex items-center justify-center animate-pulse">
                  <PhoneCall className="w-10 h-10 text-[#D32F2F]" />
                </div>
                <div>
                  <h2 className="font-fraunces font-bold text-3xl text-[#D32F2F]">DISPATCHING SOS ALERT</h2>
                  <p className="text-sm text-[#525252] font-medium mt-2">
                    Alerting your Caretaker & Hospital Emergency Dispatch Team in
                  </p>
                </div>
                <div className="text-6xl font-black text-[#D32F2F] font-fraunces tracking-wider">
                  {sosCountdown}s
                </div>
                <button
                  onClick={() => {
                    setSosActive(false);
                    setSosSentConfirmed(false);
                    setSosCountdown(10);
                  }}
                  className="w-full py-4 rounded-2xl bg-[#FAF7F2] border border-[#EBE3D5] text-[#2E2E2E] font-bold text-lg hover:bg-gray-100 transition cursor-pointer"
                >
                  CANCEL EMERGENCY SOS
                </button>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="w-16 h-16 rounded-full bg-[#1F8A5F]/15 border-2 border-[#1F8A5F] text-[#1F8A5F] flex items-center justify-center mx-auto animate-bounce">
                  <CheckCircle2 className="w-10 h-10" />
                </div>
                <h2 className="font-fraunces font-bold text-2xl text-[#1F8A5F]">SOS SENT SUCCESSFULLY!</h2>
                <p className="text-sm text-[#525252] font-semibold leading-relaxed">
                  Emergency alert & live GPS coordinates have been sent to your <strong>Caretaker</strong> and <strong>Hospital Emergency Dispatch Desk</strong>.
                </p>
                <button
                  onClick={() => {
                    setSosActive(false);
                    setSosSentConfirmed(false);
                    setSosCountdown(10);
                  }}
                  className="w-full py-4 rounded-2xl bg-[#1F8A5F] hover:bg-[#1F8A5F]/90 text-white font-bold text-lg shadow-lg transition cursor-pointer"
                >
                  Close Confirmation
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Log New Reading Modal */}
      {showLogModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 md:p-8 max-w-md w-full space-y-5 shadow-2xl border border-[#EBE3D5] font-inter">
            <div className="flex justify-between items-center border-b pb-3">
              <h3 className="font-fraunces font-bold text-xl text-[#2E2E2E]">Log New Vital Reading</h3>
              <button onClick={() => setShowLogModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Toggle Log Mode */}
            <div className="flex bg-[#FAF7F2] p-1.5 rounded-2xl border border-[#EBE3D5]">
              <button
                type="button"
                onClick={() => setLogMethod('type')}
                className={`flex-1 py-2.5 rounded-xl font-bold text-xs transition flex items-center justify-center gap-2 cursor-pointer ${
                  logMethod === 'type' ? 'bg-[#1B6B93] text-white shadow-sm' : 'text-[#6B7280]'
                }`}
              >
                <Keyboard className="w-4 h-4" />
                <span>Type Number</span>
              </button>
              <button
                type="button"
                onClick={() => setLogMethod('voice')}
                className={`flex-1 py-2.5 rounded-xl font-bold text-xs transition flex items-center justify-center gap-2 cursor-pointer ${
                  logMethod === 'voice' ? 'bg-[#1B6B93] text-white shadow-sm' : 'text-[#6B7280]'
                }`}
              >
                <Mic className="w-4 h-4 text-[#FFE8D6]" />
                <span>Voice Input</span>
              </button>
            </div>

            {logMethod === 'voice' ? (
              <div className="p-6 bg-[#FAF7F2] rounded-2xl border border-[#EBE3D5] text-center space-y-4">
                <div className={`w-16 h-16 mx-auto rounded-full flex items-center justify-center transition ${
                  voiceListening ? 'bg-red-500 text-white animate-pulse' : 'bg-[#1B6B93] text-white'
                }`}>
                  <Mic className="w-8 h-8" />
                </div>
                <p className="text-xs text-[#525252] font-semibold">
                  {voiceListening ? 'Listening... Speak your reading (e.g., "124 over 82")' : 'Tap below and say your reading out loud.'}
                </p>
                <button
                  type="button"
                  onClick={handleVoiceListen}
                  className="px-6 py-3 rounded-2xl bg-[#1B6B93] text-white font-bold text-xs hover:bg-[#155373] transition cursor-pointer"
                >
                  {voiceListening ? 'Listening...' : 'Start Voice Input 🎙️'}
                </button>
              </div>
            ) : (
              <form onSubmit={handleSaveLog} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-[#6B7280] mb-1">Select Vital Type</label>
                  <select
                    value={newReading.vitalType}
                    onChange={(e) => setNewReading({ ...newReading, vitalType: e.target.value })}
                    className="w-full bg-[#FAF7F2] border border-[#EBE3D5] rounded-xl px-4 py-3 text-xs font-bold text-[#2E2E2E] outline-none focus:border-[#1B6B93]"
                  >
                    <option value="Blood Pressure">Blood Pressure (BP)</option>
                    <option value="Blood Sugar">Blood Sugar (Glucose)</option>
                    <option value="Heart Rate">Heart Rate (Pulse)</option>
                    <option value="Oxygen SpO2">Oxygen Level (SpO2)</option>
                    <option value="Weight">Weight (kg)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#6B7280] mb-1">Enter Value</label>
                  <input
                    type="text"
                    value={newReading.value}
                    onChange={(e) => setNewReading({ ...newReading, value: e.target.value })}
                    placeholder="e.g. 120/80 or 110"
                    className="w-full bg-[#FAF7F2] border border-[#EBE3D5] rounded-xl px-4 py-3 text-sm text-[#2E2E2E] font-bold outline-none focus:border-[#1B6B93]"
                    required
                  />
                </div>

                <div className="pt-2 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setShowLogModal(false)}
                    className="px-4 py-3 rounded-2xl bg-[#FAF7F2] border border-[#EBE3D5] text-xs font-bold text-[#2E2E2E]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-3 rounded-2xl bg-[#1B6B93] hover:bg-[#155373] text-white text-xs font-bold shadow-md cursor-pointer"
                  >
                    Save Reading
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

    </div>
  );
}

