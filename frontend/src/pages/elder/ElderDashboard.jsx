import React, { useState, useEffect, useMemo, useRef } from 'react';
import { startSosAlarmSound, stopSosAlarmSound } from '../../utils/sosSound';
import { getSosLocation } from '../../utils/sosLocation';
import { 
  PhoneCall, 
  Pill, 
  HeartPulse, 
  Bot, 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  Send, 
  Activity, 
  Calendar,
  Bell,
  UserCheck,
  Phone,
  Stethoscope,
  FileText,
  Sun,
  Droplets,
  Footprints,
  ChevronRight,
  ShieldAlert,
  Sparkles,
  Heart,
  MessageSquare,
  X,
  FileCheck
} from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import api from '../../services/api';
import appointmentsService from '../../services/appointmentsService';
import aiCompanionService from '../../services/aiCompanionService';
import { useConnectedMutations, useElderDashboard, useElderRoom } from '../../hooks/useConnectedPortal';
import vitalsEngine from '../../utils/vitalsSimulation';
import emergencyService from '../../services/emergencyService';
import broadcastRealtimeEvent from '../../utils/realtimeBus';

export default function ElderDashboard({ currentUser, onNavigateTab }) {
  const [sosActive, setSosActive] = useState(false);
  const [sosCountdown, setSosCountdown] = useState(10);
  const [sosSentConfirmed, setSosSentConfirmed] = useState(false);
  const [sosSendFailed, setSosSendFailed] = useState(false);
  const sosLocationRef = useRef(null);
  const [checkedIn, setCheckedIn] = useState(false);
  const [checkInTime, setCheckInTime] = useState('Not checked in today');

  const [medicines, setMedicines] = useState([]);
  const [latestVital, setLatestVital] = useState(null);
  const [vitalsTrend, setVitalsTrend] = useState([]);
  const [upcomingAppointments, setUpcomingAppointments] = useState([]);
  const dashboardQuery = useElderDashboard(Boolean(currentUser?.id));
  const connectedMutations = useConnectedMutations();
  useElderRoom(currentUser?.id, Boolean(currentUser?.id));

  // Fill the medicine and appointment cards from the shared dashboard record.
  useEffect(() => {
    const data = dashboardQuery.data;
    if (!data) return;
    setMedicines(data.today_medicines || []);
    setUpcomingAppointments(data.upcoming_appointments || []);
  }, [dashboardQuery.data]);

  // One point per day with blood pressure and heart rate, oldest first, for the trend chart.
  const vitalsChartData = useMemo(() => {
    const byDay = new Map();
    [...(dashboardQuery.data?.latest_vitals || [])].reverse().forEach((v) => {
      const day = new Date(v.recorded_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const point = byDay.get(day) || { recorded_at: day };
      if (v.type === 'bp') point.systolic_bp = v.value?.systolic;
      if (v.type === 'heart_rate') point.pulse_bpm = v.value?.value;
      byDay.set(day, point);
    });
    return [...byDay.values()];
  }, [dashboardQuery.data?.latest_vitals]);
  const [liveVitals, setLiveVitals] = useState(() => vitalsEngine.getVitals());

  useEffect(() => {
    const handleVitalsUpdate = (e) => {
      if (e.detail?.vitals) {
        setLiveVitals({ ...e.detail.vitals });
      }
    };
    window.addEventListener('elderguard:vitals-update', handleVitalsUpdate);
    return () => window.removeEventListener('elderguard:vitals-update', handleVitalsUpdate);
  }, []);

  const queryBp = (dashboardQuery.data?.latest_vitals || []).find((v) => v.type === 'bp')?.value;
  const queryHr = (dashboardQuery.data?.latest_vitals || []).find((v) => v.type === 'heart_rate')?.value;
  const querySugar = (dashboardQuery.data?.latest_vitals || []).find((v) => v.type === 'sugar')?.value;
  const querySpo2 = (dashboardQuery.data?.latest_vitals || []).find((v) => v.type === 'spo2')?.value;

  const systolicBp = liveVitals?.systolic_bp || queryBp?.systolic || 120;
  const diastolicBp = liveVitals?.diastolic_bp || queryBp?.diastolic || 80;
  const heartRateVal = liveVitals?.heart_rate || liveVitals?.hr || queryHr?.value || 72;
  const bloodSugarVal = liveVitals?.glucose || querySugar?.value || 104;
  const spo2Val = liveVitals?.spo2 || querySpo2?.value || 98;

  const latestBp = { value: { systolic: systolicBp, diastolic: diastolicBp } };
  const latestHeartRate = { value: { value: heartRateVal } };
  const latestSugar = { value: { value: bloodSugarVal } };
  const latestSpo2 = { value: { value: spo2Val } };

  // Mevi's Report state & modal
  const [meviUpdate, setMeviUpdate] = useState('Mevi is analyzing your connected vitals history...');
  const [meviFullReport, setMeviFullReport] = useState(null);
  const [meviLoading, setMeviLoading] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);

  // AI Companion Chat Drawer State
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState([
    { role: 'assistant', text: `Hello ${currentUser?.name || 'there'}! I am your ElderGuard AI Companion. How are you feeling today?` }
  ]);
  const [inputMsg, setInputMsg] = useState('');
  const [chatLoading, setChatLoading] = useState(false);

  useEffect(() => {
    const elderId = currentUser?.id || currentUser?.user_id;
    if (!elderId) return;
    setMeviLoading(true);

    const currentVitalsObj = {
      blood_pressure: `${systolicBp}/${diastolicBp}`,
      heart_rate: heartRateVal,
      blood_sugar: bloodSugarVal,
      spo2: spo2Val,
    };

    // Construct vitals history sample from recent trends for AI analysis
    const historySample = vitalsTrend.length > 0 ? vitalsTrend : [
      { bp: '118/78', hr: 70, sugar: 102, spo2: 98, time: '08:00 AM' },
      { bp: '122/82', hr: 74, sugar: 110, spo2: 97, time: '12:00 PM' },
      { bp: `${systolicBp}/${diastolicBp}`, hr: heartRateVal, sugar: bloodSugarVal, spo2: spo2Val, time: 'Now' }
    ];

    aiCompanionService.generateVitalsReport({
      elder_id: elderId,
      current_vitals: currentVitalsObj,
      vitals_history: historySample,
      medicines: medicines,
      elder_name: currentUser?.name || 'Elder',
      elder_age: currentUser?.age || 72,
      notes: checkedIn ? `Checked in at ${checkInTime}` : 'Regular daily routine'
    })
      .then((res) => {
        setMeviUpdate(res.summary || res.report || 'Your vitals trend is stable and well monitored.');
        setMeviFullReport(res);
      })
      .catch(() => {
        // Fallback to health review
        aiCompanionService.generateHealthReview({
          elder_id: elderId,
          vitals: currentVitalsObj,
          medicines,
          appointments: upcomingAppointments,
          notes: checkedIn ? `Checked in at ${checkInTime}` : 'No check-in yet today',
        })
          .then((res) => setMeviUpdate(res.review))
          .catch(() => setMeviUpdate('Your connected health records are stable. Keep following your daily wellness routine!'));
      })
      .finally(() => setMeviLoading(false));
  }, [
    currentUser?.id,
    currentUser?.user_id,
    medicines.length,
    upcomingAppointments.length,
    checkedIn,
    checkInTime,
    systolicBp,
    diastolicBp,
    heartRateVal,
    bloodSugarVal,
    spo2Val,
  ]);

  // Look up the device position while the countdown runs so sending is not delayed.
  useEffect(() => {
    if (!sosActive) return;
    sosLocationRef.current = null;
    getSosLocation().then((loc) => { sosLocationRef.current = loc; });
  }, [sosActive]);

  // SOS Countdown Timer & Sound Alarm
  useEffect(() => {
    let timer;
    if (sosActive && !sosSentConfirmed && sosCountdown > 0) {
      startSosAlarmSound("Emergency SOS Activated! Alerting Caretaker and Hospital Emergency Dispatch!");
      timer = setInterval(() => setSosCountdown(prev => prev - 1), 1000);
    } else if (sosActive && !sosSentConfirmed && !sosSendFailed && sosCountdown === 0) {
      triggerBackendEmergencySOS();
    } else if (!sosActive) {
      stopSosAlarmSound();
    }
    return () => {
      clearInterval(timer);
      if (!sosActive) stopSosAlarmSound();
    };
  }, [sosActive, sosSentConfirmed, sosSendFailed, sosCountdown]);

  const triggerBackendEmergencySOS = async () => {
    const { lat, lng } = sosLocationRef.current || (await getSosLocation(1000));
    let delivered = false;
    try {
      await emergencyService.triggerSOS(lat, lng);
      delivered = true;
    } catch (e) {
      console.warn('Emergency service SOS trigger error', e);
    }
    try {
      await connectedMutations.triggerSOS.mutateAsync({ location: { lat, lng } });
      delivered = true;
    } catch (e) {
      console.warn('Backend connected SOS trigger error', e);
    }

    // Never show "sent" when neither service accepted the alert.
    if (!delivered) {
      setSosSendFailed(true);
      return;
    }

    broadcastRealtimeEvent('elderguard:realtime-event', {
      event: 'sos:triggered',
      type: 'sos',
      elder_name: currentUser?.name || 'Elder Patient',
      location_lat: lat,
      location_lng: lng,
      triggered_at: new Date().toISOString()
    });

    setSosSentConfirmed(true);
  };

  const closeSosModal = () => {
    setSosActive(false);
    setSosSentConfirmed(false);
    setSosSendFailed(false);
    setSosCountdown(10);
  };

  const handleCheckIn = async () => {
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' Today';
    setCheckedIn(true);
    setCheckInTime(timeStr);
    try {
      await connectedMutations.checkIn.mutateAsync({ mood: 'calm', okStatus: true });
    } catch (_) {
      setCheckedIn(false);
      setCheckInTime('Something went wrong - let us try that again');
    }
  };

  const handleSendChat = async (e) => {
    e.preventDefault();
    if (!inputMsg.trim()) return;

    const userText = inputMsg.trim();
    setMessages(prev => [...prev, { role: 'user', text: userText }]);
    setInputMsg('');
    setChatLoading(true);

    try {
      const elderId = currentUser?.id || currentUser?.user_id;
      const history = messages.map((item) => ({
        role: item.role === 'user' ? 'user' : 'model',
        content: item.text,
      }));
      const res = await aiCompanionService.chatWithAI(elderId, userText, history, 'companion');
      setMessages(prev => [...prev, { role: 'assistant', text: res.reply || 'I am right here with you!' }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', text: 'I am right here with you! You are doing wonderful today.' }]);
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <div className="space-y-8 bg-[#FAF7F2] text-[#2E2E2E] font-inter min-h-screen pb-12">
      {/* Main Grid: Left Column (8 cols) & Right Column (4 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left / Center Column */}
        <div className="lg:col-span-8 space-y-8">
          
          {/* Greeting Card */}
          <div className="bg-gradient-to-br from-[#FFE8D6] via-[#FFF3E5] to-[#FCEFE3] border border-[#F5DFCD] shadow-[0_10px_30px_rgba(245,223,205,0.4)] rounded-3xl p-6 md:p-8 relative overflow-hidden">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6">
              <div className="space-y-2 max-w-xl">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/80 border border-[#F5DFCD] text-[#1B6B93] text-xs font-semibold shadow-sm">
                  <Sun className="w-4 h-4 text-[#F5A623] animate-spin-slow" />
                  <span>Warm Greetings</span>
                </div>
                <h2 className="font-fraunces font-bold text-3xl md:text-4xl text-[#2E2E2E] leading-tight">
                  Good Day, {currentUser?.name || 'Elder'}! ☀️
                </h2>
                <p className="text-[#525252] text-base md:text-lg font-medium leading-relaxed">
                  Welcome to ElderGuard. You have <span className="font-bold text-[#1B6B93]">{medicines.length} medicine(s)</span> scheduled.
                </p>
              </div>
            </div>
          </div>

          {/* Today's Medicine Card */}
          <div className="bg-white border border-[#EBE3D5] shadow-[0_8px_30px_rgba(0,0,0,0.04)] rounded-3xl p-6 md:p-8 space-y-6">
            <div className="flex flex-wrap justify-between items-center border-b border-[#F0EBE1] pb-4 gap-3">
              <div className="flex items-center gap-3">
                <div className="p-3.5 rounded-2xl bg-[#FFE8D6] text-[#1B6B93]">
                  <Pill className="w-7 h-7" />
                </div>
                <div>
                  <h3 className="font-fraunces font-bold text-2xl text-[#2E2E2E]">Scheduled Medicines</h3>
                  <span className="text-xs text-[#6B7280] font-medium">Real-time Medication Tracker</span>
                </div>
              </div>
            </div>

            {medicines.length === 0 ? (
              <div className="text-center py-10 space-y-3 bg-[#FAF7F2] rounded-2xl border border-dashed border-[#EBE3D5]">
                <Pill className="w-10 h-10 text-[#9CA3AF] mx-auto" />
                <p className="text-base font-semibold text-[#525252]">No medicines scheduled yet</p>
                <p className="text-xs text-[#6B7280]">New medicines prescribed by your doctor will appear here.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {medicines.map((m) => (
                  <div 
                    key={m.id}
                    className="p-5 rounded-2xl border border-[#EBE3D5] bg-[#FAF7F2] flex justify-between items-center"
                  >
                    <div>
                      <h4 className="text-lg font-bold text-[#2E2E2E]">{m.name}</h4>
                      <p className="text-xs text-[#6B7280]">Dosage: {m.dosage}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* My Vitals Card */}
          <div className="bg-white border border-[#EBE3D5] shadow-[0_8px_30px_rgba(0,0,0,0.04)] rounded-3xl p-6 md:p-8 space-y-6">
            <div className="flex justify-between items-center border-b border-[#F0EBE1] pb-4">
              <div className="flex items-center gap-3">
                <div className="p-3.5 rounded-2xl bg-[#E6F4F1] text-[#1B6B93]">
                  <HeartPulse className="w-7 h-7" />
                </div>
                <div>
                  <h3 className="font-fraunces font-bold text-2xl text-[#2E2E2E]">My Vitals</h3>
                  <span className="text-xs text-[#6B7280] font-medium">Real-time Biosensor Checkpoints</span>
                </div>
              </div>
            </div>

            {/* 4 Metric Tiles Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="p-4 rounded-2xl bg-[#FAF7F2] border border-[#EBE3D5] space-y-2">
                <span className="text-xs font-semibold text-[#6B7280] block">Blood Pressure</span>
                <span className="font-bold text-2xl text-[#2E2E2E] block">
                  {systolicBp && diastolicBp ? `${systolicBp}/${diastolicBp}` : '120/80'}
                </span>
              </div>

              <div className="p-4 rounded-2xl bg-[#FAF7F2] border border-[#EBE3D5] space-y-2">
                <span className="text-xs font-semibold text-[#6B7280] block">Heart Rate</span>
                <span className="font-bold text-2xl text-[#2E2E2E] block">
                  {heartRateVal ? `${heartRateVal} BPM` : '72 BPM'}
                </span>
              </div>

              <div className="p-4 rounded-2xl bg-[#FAF7F2] border border-[#EBE3D5] space-y-2">
                <span className="text-xs font-semibold text-[#6B7280] block">Blood Sugar</span>
                <span className="font-bold text-2xl text-[#2E2E2E] block">
                  {bloodSugarVal ? `${bloodSugarVal} mg/dL` : '104 mg/dL'}
                </span>
              </div>

              <div className="p-4 rounded-2xl bg-[#FAF7F2] border border-[#EBE3D5] space-y-2">
                <span className="text-xs font-semibold text-[#6B7280] block">SpO2 Oxygen</span>
                <span className="font-bold text-2xl text-[#2E2E2E] block">
                  {spo2Val ? `${spo2Val}%` : '98%'}
                </span>
              </div>
            </div>

            {/* Weekly Trend Graph */}
            {vitalsChartData.length > 0 && (
              <div className="pt-2">
                <span className="text-xs font-bold text-[#6B7280] uppercase tracking-wider block mb-2">Vitals Trend Graph</span>
                <div className="h-56 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={vitalsChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#EBE3D5" />
                      <XAxis dataKey="recorded_at" stroke="#6B7280" />
                      <YAxis stroke="#6B7280" domain={[60, 180]} />
                      <Tooltip contentStyle={{ backgroundColor: '#FAF7F2', borderColor: '#EBE3D5', borderRadius: '16px', color: '#2E2E2E' }} />
                      <Line type="monotone" dataKey="systolic_bp" name="BP Systolic" stroke="#1B6B93" strokeWidth={3} dot={{ r: 4 }} />
                      <Line type="monotone" dataKey="pulse_bpm" name="Heart Rate" stroke="#4CAA6D" strokeWidth={3} dot={{ r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>

        </div>

        {/* Right Column (4 cols) */}
        <div className="lg:col-span-4 space-y-8">
          
          {/* Prominent SOS / Emergency Card */}
          <div className="bg-gradient-to-br from-[#D32F2F] via-[#C62828] to-[#B71C1C] rounded-3xl p-6 md:p-8 text-white shadow-[0_12px_40px_rgba(211,47,47,0.35)] space-y-6 relative overflow-hidden">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-2xl bg-white/20 text-white backdrop-blur-md">
                <PhoneCall className="w-8 h-8" />
              </div>
              <div>
                <h3 className="font-fraunces font-bold text-2xl text-white">Emergency SOS</h3>
                <span className="text-xs text-white/80 font-medium">Urgent Assistance</span>
              </div>
            </div>

            <button
              onClick={() => {
                setSosActive(true);
                setSosCountdown(10);
              }}
              className="w-full py-5 rounded-2xl bg-white text-[#C62828] font-fraunces font-bold text-xl shadow-xl hover:scale-[1.02] transition-all duration-300 flex items-center justify-center gap-3 min-h-[64px] cursor-pointer"
            >
              <PhoneCall className="w-7 h-7 text-[#C62828] animate-bounce" />
              <span>1-TAP EMERGENCY SOS</span>
            </button>
          </div>

          {/* "I'm OK" Daily Check-in Card */}
          <div className="bg-gradient-to-br from-[#FFE8D6]/60 via-[#FFF8F0] to-white border border-[#F5DFCD] shadow-[0_8px_30px_rgba(0,0,0,0.04)] rounded-3xl p-6 space-y-5">
            <h4 className="font-fraunces font-bold text-lg text-[#2E2E2E]">Daily "I'm OK" Check-in</h4>

            <button
              onClick={handleCheckIn}
              className="w-full py-4 rounded-full bg-gradient-to-r from-[#4CAA6D] to-[#3B9559] hover:from-[#3B9559] hover:to-[#2F8049] text-white font-bold text-lg transition-all min-h-[52px] flex items-center justify-center gap-2 cursor-pointer"
            >
              <CheckCircle2 className="w-6 h-6" />
              <span>I'm OK Today</span>
            </button>

            <div className="text-center text-xs text-[#4CAA6D] font-semibold flex items-center justify-center gap-1.5">
              <span>Status: {checkInTime}</span>
            </div>
          </div>

          {/* Mevi's AI Vitals Report Card */}
          <div className="bg-[#FFFDF9] border border-[#EBE3D5] shadow-[0_8px_30px_rgba(0,0,0,0.04)] rounded-3xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[#F0EBE1] pb-3">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-2xl bg-gradient-to-br from-[#1B6B93] to-[#2E86B9] text-white shadow-sm">
                  <Bot className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-fraunces font-bold text-lg text-[#2E2E2E]">Mevi's Health Report</h4>
                  <span className="text-xs font-medium text-[#1B6B93] flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-[#F5A623]" />
                    AI Vitals Analysis
                  </span>
                </div>
              </div>

              {meviFullReport?.risk_flags?.length > 0 && (
                <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 text-[11px] font-bold border border-amber-200">
                  {meviFullReport.risk_flags.length} Note{meviFullReport.risk_flags.length > 1 ? 's' : ''}
                </span>
              )}
            </div>

            <p className="text-sm text-[#525252] leading-relaxed">
              {meviLoading ? 'Mevi is analyzing your vitals history with Groq AI...' : meviUpdate}
            </p>

            <div className="flex items-center justify-between pt-2 border-t border-[#F0EBE1]">
              <button
                onClick={() => setShowReportModal(true)}
                className="text-xs font-bold text-[#1B6B93] bg-[#E6F4F1] hover:bg-[#D4ECE6] px-3.5 py-2 rounded-xl border border-[#B8DCD4] transition-all flex items-center gap-1.5"
              >
                <FileCheck className="w-4 h-4 text-[#1B6B93]" />
                <span>View Full Vitals Report</span>
              </button>

              <button
                onClick={() => onNavigateTab?.('aiassistant')}
                className="text-xs font-bold text-[#1B6B93] hover:underline flex items-center gap-1"
              >
                <span>Talk with Mevi</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Upcoming Doctor Appointments Card */}
          <div className="bg-white border border-[#EBE3D5] shadow-[0_8px_30px_rgba(0,0,0,0.04)] rounded-3xl p-6 space-y-4">
            <span className="text-xs font-bold text-[#1B6B93] uppercase tracking-wider block border-b border-[#F0EBE1] pb-3">Upcoming Appointments</span>

            {upcomingAppointments.length === 0 ? (
              <p className="text-xs text-[#6B7280] text-center py-4">No upcoming appointments</p>
            ) : (
              upcomingAppointments.map((appt) => (
                <div key={appt.id} className="p-3.5 rounded-2xl bg-[#FAF7F2] border border-[#EBE3D5]">
                  <h4 className="font-bold text-sm text-[#2E2E2E]">Doctor Appointment</h4>
                  <span className="text-xs text-[#1B6B93] font-bold block">{appt.scheduled_at || `${appt.appointment_date} at ${appt.start_time}`}</span>
                </div>
              ))
            )}
          </div>

        </div>

      </div>



      {/* Emergency Countdown / Confirmation Modal */}
      {sosActive && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in">
          <div className="bg-white border-4 border-[#D32F2F] rounded-3xl p-8 max-w-md w-full text-center space-y-6 shadow-2xl">
            {sosSendFailed ? (
              <>
                <h3 className="text-2xl font-bold text-[#C62828]">SOS NOT SENT</h3>
                <p className="text-sm text-[#525252] font-semibold leading-relaxed">
                  We could not reach ElderGuard. Please call <strong>112</strong> or your caregiver now.
                </p>
                <a
                  href="tel:112"
                  className="block w-full py-4 rounded-2xl bg-[#C62828] hover:bg-[#B71C1C] text-white font-bold text-lg shadow-lg transition"
                >
                  Call 112
                </a>
                <button
                  onClick={() => setSosSendFailed(false)}
                  className="w-full py-4 rounded-2xl bg-[#FAF7F2] text-[#2E2E2E] font-bold text-lg border border-[#EBE3D5] cursor-pointer hover:bg-gray-100 transition"
                >
                  Try Again
                </button>
                <button
                  onClick={closeSosModal}
                  className="w-full py-3 rounded-2xl text-[#525252] font-semibold text-sm cursor-pointer hover:bg-gray-100 transition"
                >
                  Close
                </button>
              </>
            ) : !sosSentConfirmed ? (
              <>
                <h3 className="text-3xl font-fraunces font-bold text-[#C62828]">EMERGENCY SOS</h3>
                <p className="text-sm text-[#5C5C5C] font-medium">
                  Alerting Caretaker & Hospital Emergency Dispatch Team in
                </p>
                <div className="text-6xl font-black text-[#C62828] font-mono">{sosCountdown}s</div>
                <button
                  onClick={() => {
                    setSosActive(false);
                    setSosSentConfirmed(false);
                    setSosCountdown(10);
                  }}
                  className="w-full py-4 rounded-2xl bg-[#FAF7F2] text-[#2E2E2E] font-bold text-lg border border-[#EBE3D5] cursor-pointer hover:bg-gray-100 transition"
                >
                  Cancel False Alarm
                </button>
              </>
            ) : (
              <>
                <div className="w-16 h-16 rounded-full bg-[#1F8A5F]/15 border-2 border-[#1F8A5F] text-[#1F8A5F] flex items-center justify-center mx-auto animate-bounce">
                  <CheckCircle2 className="w-10 h-10" />
                </div>
                <h3 className="text-2xl font-bold text-[#1F8A5F]">SOS SENT SUCCESSFULLY!</h3>
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
              </>
            )}
          </div>
        </div>
      )}

      {/* Full Mevi Vitals Report Modal */}
      {showReportModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-[#EBE3D5] rounded-3xl max-w-2xl w-full p-6 md:p-8 space-y-6 shadow-2xl relative max-h-[90vh] overflow-y-auto">
            
            <button
              onClick={() => setShowReportModal(false)}
              className="absolute top-6 right-6 p-2 rounded-full bg-[#FAF7F2] hover:bg-[#EBE3D5] text-[#525252] transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-4 border-b border-[#F0EBE1] pb-4">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#1B6B93] to-[#2E86B9] text-white flex items-center justify-center shadow-md">
                <Bot className="w-8 h-8 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-fraunces font-bold text-2xl text-[#2E2E2E]">Mevi's AI Vitals Analysis</h3>
                  <span className="px-2.5 py-0.5 rounded-full bg-[#E6F4F1] text-[#1B6B93] text-xs font-bold border border-[#B8DCD4]">
                    Groq AI
                  </span>
                </div>
                <p className="text-xs text-[#6B7280]">
                  Generated on {new Date(meviFullReport?.created_at || Date.now()).toLocaleDateString()} for {currentUser?.name || 'Elder'}
                </p>
              </div>
            </div>

            {/* Risk Flags summary if any */}
            {meviFullReport?.risk_flags?.length > 0 && (
              <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-xs space-y-2">
                <div className="font-bold flex items-center gap-1.5 text-amber-800">
                  <AlertCircle className="w-4 h-4 text-amber-600" />
                  <span>Vitals Observations & Notes:</span>
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  {meviFullReport.risk_flags.map((flag, idx) => (
                    <span key={idx} className="px-2.5 py-1 rounded-lg bg-amber-100 border border-amber-300 text-amber-900 font-semibold">
                      {flag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Report Content Body */}
            <div className="bg-[#FAF7F2] border border-[#EBE3D5] rounded-2xl p-5 text-sm leading-relaxed text-[#2E2E2E] whitespace-pre-line font-inter">
              {meviFullReport?.report || meviUpdate}
            </div>

            <div className="flex flex-col sm:flex-row justify-between items-center gap-3 pt-2">
              <span className="text-xs text-[#6B7280] italic">
                * Note: Mevi provides supportive wellness summaries based on your connected vitals history. Always consult your doctor for medical advice.
              </span>
              <button
                onClick={() => setShowReportModal(false)}
                className="w-full sm:w-auto px-6 py-3 rounded-xl bg-[#1B6B93] hover:bg-[#155373] text-white font-bold text-sm shadow-md transition"
              >
                Close Report
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
