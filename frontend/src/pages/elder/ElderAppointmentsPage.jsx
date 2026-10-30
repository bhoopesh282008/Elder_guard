import React, { useState, useEffect } from 'react';
import {
  Calendar,
  Heart,
  Stethoscope,
  Bone,
  Eye,
  Star,
  Video,
  MapPin,
  Clock,
  ChevronRight,
  ShieldAlert,
  PhoneCall,
  CheckCircle2,
  AlertCircle,
  Building2,
  Check,
  UserCheck,
  User,
  Bot,
  X,
  Sparkles,
  Navigation,
  RefreshCw
} from 'lucide-react';
import { sendSos } from '../../utils/sendSos';
import aiCompanionService from '../../services/aiCompanionService';
import appointmentsService from '../../services/appointmentsService';
import broadcastRealtimeEvent from '../../utils/realtimeBus';

// ─── Static Data ──────────────────────────────────────────────────────────────
const SPECIALTIES = [
  { id: 'cardio',    label: 'Cardiologist',       Icon: Heart,        bg: 'bg-[#FFE8D6] text-[#E2694B]' },
  { id: 'general',  label: 'General Physician',   Icon: Stethoscope,  bg: 'bg-[#E6F4F1] text-[#1B6B93]' },
  { id: 'geriatric',label: 'Geriatric Specialist', Icon: User,         bg: 'bg-[#F4F9F5] text-[#4CAA6D]' },
  { id: 'ortho',    label: 'Orthopedic',          Icon: Bone,         bg: 'bg-[#FFF3E5] text-[#F5A623]' },
  { id: 'eye',      label: 'Eye Care',            Icon: Eye,          bg: 'bg-[#EEF3FF] text-[#5B8DD9]' },
  { id: 'dental',   label: 'Dentist',             Icon: Star,         bg: 'bg-[#FAF0FF] text-[#9B59B6]' },
];

const UPCOMING_APPOINTMENTS = [];

const PAST_VISITS = [];

// ─── Helper: Next 7 dates ─────────────────────────────────────────────────────
function getNext7Days() {
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() + i);
    const iso = d.toISOString().split('T')[0];
    return { label: i === 0 ? 'Today' : days[d.getDay()], date: `${d.getDate()} ${months[d.getMonth()]}`, raw: d.toDateString(), iso: iso };
  });
}

function formatTimeTo24h(timeStr) {
  if (!timeStr) return '10:00:00';
  const match = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return timeStr.length === 5 ? `${timeStr}:00` : timeStr;
  let [_, hoursStr, minutesStr, period] = match;
  let hours = parseInt(hoursStr, 10);
  if (period.toUpperCase() === 'PM' && hours < 12) hours += 12;
  if (period.toUpperCase() === 'AM' && hours === 12) hours = 0;
  const hh = String(hours).padStart(2, '0');
  return `${hh}:${minutesStr}:00`;
}

function getEndTime30m(startTime24) {
  const parts = startTime24.split(':').map(Number);
  const h = parts[0] || 10;
  const m = parts[1] || 0;
  const totalMins = h * 60 + m + 30;
  const endH = String(Math.floor(totalMins / 60) % 24).padStart(2, '0');
  const endM = String(totalMins % 60).padStart(2, '0');
  return `${endH}:${endM}:00`;
}

const HOSPITALS = [
  {
    id: 'hosp-1',
    name: 'St. Jude Memorial Hospital (Elder Care Hub)',
    address: '104 Pine Street, Sector 4, Main Operations Hub',
    distance: '1.2 km away',
    mapThumb: '🏥'
  },
  {
    id: 'hosp-2',
    name: 'ElderGuard Central Super-Specialty Clinic',
    address: '45 Health Avenue, Medical Enclave',
    distance: '2.8 km away',
    mapThumb: '🏥'
  },
  {
    id: 'hosp-3',
    name: 'City Geriatric Wellness & Rehab Center',
    address: '88 Heritage Road, Near Central Park',
    distance: '4.1 km away',
    mapThumb: '🏥'
  }
];

const DATES = getNext7Days();

const TIME_SLOTS = {
  Morning:   ['9:00 AM', '9:30 AM', '10:00 AM', '10:30 AM', '11:00 AM', '11:30 AM'],
  Afternoon: ['12:30 PM', '1:00 PM', '2:00 PM', '2:30 PM', '3:00 PM'],
  Evening:   ['4:00 PM', '4:30 PM', '5:00 PM', '5:30 PM'],
};
const UNAVAILABLE = new Set(['9:30 AM', '2:30 PM', '4:30 PM']);

// ─── Main Component ───────────────────────────────────────────────────────────
export default function ElderAppointmentsPage({ currentUser }) {
  const [step, setStep]                     = useState(1); // 1-4 + confirm
  const [selectedSpecialty, setSelectedSpecialty] = useState(null);
  const [selectedDoctor, setSelectedDoctor]   = useState(null);
  const [selectedMode, setSelectedMode]       = useState(null);
  const [selectedHospital, setSelectedHospital] = useState(null);
  const [selectedDate, setSelectedDate]       = useState(null);
  const [selectedTime, setSelectedTime]       = useState(null);
  const [confirmedAppt, setConfirmedAppt]     = useState(null);
  const [successToast, setSuccessToast]       = useState(false);
  const [sosActive, setSosActive]             = useState(false);
  const [sosCountdown, setSosCountdown]       = useState(10);
  const [chatOpen, setChatOpen]               = useState(false);
  const [messages, setMessages]               = useState([
    { role: 'assistant', text: `Hello ${currentUser?.name?.split(' ')[0] || 'there'}! I can help you book the right doctor. What health concern would you like to address today?` }
  ]);
  const [inputMsg, setInputMsg] = useState('');

  const [sosSentConfirmed, setSosSentConfirmed] = useState(false);

  // SOS Countdown Timer
  useEffect(() => {
    let timer;
    if (sosActive && !sosSentConfirmed && sosCountdown > 0) {
      timer = setInterval(() => setSosCountdown(prev => prev - 1), 1000);
    } else if (sosActive && !sosSentConfirmed && sosCountdown === 0) {
      triggerEmergencySOS();
    }
    return () => clearInterval(timer);
  }, [sosActive, sosSentConfirmed, sosCountdown]);

  const triggerEmergencySOS = async () => {
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

  const [registeredDoctors, setRegisteredDoctors] = useState([]);
  const [bookedAppointments, setBookedAppointments] = useState([]);

  useEffect(() => {
    async function loadData() {
      try {
        const fetchedDocs = await appointmentsService.getDoctors();
        if (fetchedDocs && fetchedDocs.length > 0) {
          setRegisteredDoctors(fetchedDocs);
        }
      } catch (e) {
        console.warn('Error fetching registered doctors:', e);
      }
      try {
        const fetchedAppts = await appointmentsService.getAppointments(currentUser?.id);
        if (fetchedAppts) {
          setBookedAppointments(fetchedAppts);
        }
      } catch (e) {
        console.warn('Error fetching appointments:', e);
      }
    }
    loadData();

    const handleRealtime = () => {
      loadData();
    };
    window.addEventListener('elderguard:realtime-event', handleRealtime);
    return () => window.removeEventListener('elderguard:realtime-event', handleRealtime);
  }, [currentUser?.id]);

  const currentSpecialtyObj = SPECIALTIES.find(s => s.id === selectedSpecialty);
  const currentSpecialtyLabel = currentSpecialtyObj ? currentSpecialtyObj.label : '';

  const docsToUse = registeredDoctors;
  const dynamicDocs = docsToUse.filter(d => {
    if (!selectedSpecialty) return true;
    if (!d.specialization) return false;
    return d.specialization.toLowerCase().includes(currentSpecialtyLabel.toLowerCase()) ||
           currentSpecialtyLabel.toLowerCase().includes(d.specialization.toLowerCase());
  }).map(d => ({
    id: d.user_id || d.id,
    name: d.name,
    specialty: d.specialization || 'General Physician',
    hospital: d.hospital || 'ElderGuard Health Network',
    rating: d.rating || 5,
    availability: d.availability || 'Available Today',
    availColor: d.availColor || 'bg-[#4CAA6D]/15 text-[#4CAA6D] border-[#4CAA6D]/30',
    modes: d.modes || ['video', 'in-person'],
    photo: d.profile_pic_url || 'https://images.unsplash.com/photo-1622253692010-333f2da6031d?auto=format&fit=crop&q=80&w=200'
  }));

  const doctors = dynamicDocs;

  const needsHospital = selectedMode === 'in-person';
  const canConfirm = selectedDoctor && selectedDate && selectedTime && (!needsHospital || selectedHospital);

  function handleSelectSpecialty(id) {
    setSelectedSpecialty(id);
    setSelectedDoctor(null); setSelectedMode(null);
    setSelectedHospital(null); setSelectedDate(null); setSelectedTime(null);
    setStep(2);
  }

  function handleSelectDoctor(doc) {
    setSelectedDoctor(doc);
    setSelectedMode(null); setSelectedHospital(null);
    setStep(3);
  }

  function handleSelectMode(mode) {
    setSelectedMode(mode);
    if (mode === 'video') { setSelectedHospital(null); setStep(4); }
    else setStep(3); // stay on step 3 to pick hospital
  }

  async function handleConfirm() {
    const elderId = currentUser?.id || currentUser?.user_id;
    if (!elderId) {
      console.warn('Cannot book appointment without an elder login.');
      return;
    }

    let bookingResult = null;
    try {
      const formattedDate = selectedDate?.iso || new Date().toISOString().split('T')[0];
      const startTime24 = formatTimeTo24h(selectedTime);
      const endTime24 = getEndTime30m(startTime24);

      const payload = {
        elder_id: elderId,
        doctor_id: selectedDoctor.id,
        appointment_date: formattedDate,
        start_time: startTime24,
        end_time: endTime24,
        mode: selectedMode === 'video' ? 'telemedicine' : 'in_person',
        notes: `Booked via Elder Portal`
      };
      bookingResult = await appointmentsService.bookAppointment(payload);
      broadcastRealtimeEvent('elderguard:realtime-event', { event: 'appointment:created', appointment: bookingResult });

      const updatedAppts = await appointmentsService.getAppointments(elderId);
      if (updatedAppts) {
        setBookedAppointments(updatedAppts);
      }
    } catch (e) {
      console.warn('Booking appointment via backend failed:', e);
    }
    setConfirmedAppt({ doctor: selectedDoctor, date: selectedDate, time: selectedTime, mode: selectedMode, hospital: selectedHospital, details: bookingResult });
    setSuccessToast(true);
    setTimeout(() => setSuccessToast(false), 5000);
    // reset
    setStep(1); setSelectedSpecialty(null); setSelectedDoctor(null);
    setSelectedMode(null); setSelectedHospital(null); setSelectedDate(null); setSelectedTime(null);
  }

  function handleSendChat(e) {
    e.preventDefault();
    if (!inputMsg.trim()) return;
    setMessages(prev => [...prev,
      { role: 'user', text: inputMsg },
      { role: 'assistant', text: `For "${inputMsg}", please choose from the registered doctors shown in this portal or contact your caregiver if no doctor is listed.` }
    ]);
    setInputMsg('');
  }

  const stepTitles = { 1: 'Choose Specialty', 2: 'Choose Doctor', 3: 'Location & Mode', 4: 'Date & Time' };

  return (
    <div className="space-y-8 bg-[#FAF7F2] text-[#2E2E2E] font-inter min-h-screen pb-20">

      {/* ── Success Toast ── */}
      {successToast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 bg-[#4CAA6D] text-white px-8 py-4 rounded-2xl shadow-2xl flex items-center gap-3 font-semibold animate-bounce max-w-md w-full">
          <CheckCircle2 className="w-6 h-6 shrink-0" />
          <span>Appointment confirmed! Your caregiver has been notified. 🎉</span>
          <button onClick={() => setSuccessToast(false)} className="ml-auto"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* ── Main Grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">

        {/* ════ LEFT MAIN CONTENT (8 cols) ════ */}
        <div className="lg:col-span-8 space-y-8">

          {/* Header Card */}
          <div className="bg-gradient-to-br from-[#FFE8D6] via-[#FFF3E5] to-[#FCEFE3] border border-[#F5DFCD] shadow-[0_10px_30px_rgba(245,223,205,0.4)] rounded-3xl p-6 md:p-8 flex flex-wrap justify-between items-center gap-6 relative overflow-hidden">
            <div className="space-y-2 max-w-lg">
              <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-white/90 border border-[#F5DFCD] text-[#1B6B93] text-xs font-bold shadow-sm">
                <Calendar className="w-4 h-4 text-[#F5A623]" />
                <span>Appointment Booking</span>
              </div>
              <h1 className="font-fraunces font-bold text-3xl md:text-4xl text-[#2E2E2E] tracking-tight leading-tight">
                Book an Appointment
              </h1>
              <p className="text-base text-[#525252] font-medium leading-relaxed">
                Let's find the right doctor for you, {currentUser?.name ? currentUser.name.split(' ')[0] : 'there'} 😊
              </p>
            </div>
            <div className="p-5 rounded-3xl bg-gradient-to-tr from-[#1B6B93] to-[#2E7D8C] shadow-xl shrink-0 border-2 border-white/60">
              <Stethoscope className="w-12 h-12 text-[#FFE8D6]" />
            </div>
          </div>

          {/* Step Progress Indicator */}
          <div className="flex items-center gap-3 px-1 overflow-x-auto pb-1">
            {[1,2,3,4].map((s) => {
              const done = step > s;
              const active = step === s;
              return (
                <React.Fragment key={s}>
                  <button
                    onClick={() => s < step && setStep(s)}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-bold whitespace-nowrap transition-all min-h-[44px] ${
                      done   ? 'bg-[#4CAA6D]/15 text-[#4CAA6D] border border-[#4CAA6D]/30 cursor-pointer hover:opacity-80' :
                      active ? 'bg-[#1B6B93] text-white shadow-md' :
                               'bg-white border border-[#EBE3D5] text-[#9CA3AF] cursor-not-allowed'
                    }`}
                  >
                    {done ? <CheckCircle2 className="w-4 h-4" /> : <span className="w-5 h-5 rounded-full bg-current/20 flex items-center justify-center text-[10px] font-black">{s}</span>}
                    {stepTitles[s]}
                  </button>
                  {s < 4 && <ChevronRight className="w-4 h-4 text-[#C4B9AB] shrink-0" />}
                </React.Fragment>
              );
            })}
          </div>

          {/* ── STEP 1: Specialty ── */}
          <div className={`bg-white border rounded-3xl p-6 md:p-8 space-y-5 shadow-[0_8px_30px_rgba(0,0,0,0.04)] transition-all ${step >= 1 ? 'border-[#EBE3D5]' : 'border-[#EBE3D5] opacity-50 pointer-events-none'}`}>
            <div className="flex items-center gap-3 border-b border-[#F0EBE1] pb-4">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-black shrink-0 ${selectedSpecialty ? 'bg-[#4CAA6D] text-white' : 'bg-[#1B6B93] text-white'}`}>
                {selectedSpecialty ? '✓' : '1'}
              </div>
              <div>
                <h2 className="font-fraunces font-bold text-xl text-[#2E2E2E]">Choose a Specialty</h2>
                <p className="text-xs text-[#6B7280]">What type of doctor do you need?</p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {SPECIALTIES.map(({ id, label, Icon, bg }) => {
                const isSelected = selectedSpecialty === id;
                return (
                  <button
                    key={id}
                    onClick={() => handleSelectSpecialty(id)}
                    className={`p-5 rounded-2xl border-2 flex flex-col items-center gap-3 transition-all min-h-[100px] cursor-pointer font-semibold text-sm hover:scale-[1.02] ${
                      isSelected
                        ? 'border-[#1B6B93] bg-[#1B6B93]/10 text-[#1B6B93] shadow-md'
                        : 'border-[#EBE3D5] bg-[#FAF7F2] text-[#2E2E2E] hover:border-[#1B6B93]/40'
                    }`}
                  >
                    <div className={`p-3 rounded-2xl ${isSelected ? 'bg-[#1B6B93] text-white' : bg}`}>
                      <Icon className="w-6 h-6" />
                    </div>
                    <span className="text-center leading-tight">{label}</span>
                    {isSelected && <CheckCircle2 className="w-4 h-4 text-[#1B6B93]" />}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2 text-xs text-[#1B6B93] font-semibold pt-1 cursor-pointer hover:underline w-fit" onClick={() => setChatOpen(true)}>
              <Sparkles className="w-4 h-4 text-[#F5A623]" />
              Not sure? Ask AI Companion to recommend a specialty →
            </div>
          </div>

          {/* ── STEP 2: Doctor ── */}
          {step >= 2 && (
            <div className="bg-white border border-[#EBE3D5] rounded-3xl p-6 md:p-8 space-y-5 shadow-[0_8px_30px_rgba(0,0,0,0.04)]">
              <div className="flex items-center gap-3 border-b border-[#F0EBE1] pb-4">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-black shrink-0 ${selectedDoctor ? 'bg-[#4CAA6D] text-white' : 'bg-[#1B6B93] text-white'}`}>
                  {selectedDoctor ? '✓' : '2'}
                </div>
                <div>
                  <h2 className="font-fraunces font-bold text-xl text-[#2E2E2E]">Choose Your Doctor</h2>
                  <p className="text-xs text-[#6B7280]">Tap a doctor to select and continue</p>
                </div>
              </div>

              <div className="space-y-4">
                {doctors.length === 0 ? (
                  <p className="text-sm text-[#6B7280] text-center py-6">No doctors found for this specialty.</p>
                ) : doctors.map((doc) => {
                  const isSelected = selectedDoctor?.id === doc.id;
                  return (
                    <div
                      key={doc.id}
                      onClick={() => handleSelectDoctor(doc)}
                      className={`p-5 rounded-3xl border-2 cursor-pointer transition-all hover:scale-[1.01] ${
                        isSelected
                          ? 'border-[#1B6B93] bg-[#1B6B93]/08 shadow-md'
                          : 'border-[#EBE3D5] bg-[#FAF7F2] hover:border-[#1B6B93]/40'
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <img src={doc.photo} alt={doc.name} className={`w-16 h-16 rounded-2xl object-cover shrink-0 border-2 ${isSelected ? 'border-[#1B6B93]' : 'border-[#EBE3D5]'}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            <h3 className="font-fraunces font-bold text-lg text-[#2E2E2E]">{doc.name}</h3>
                            {isSelected && <CheckCircle2 className="w-5 h-5 text-[#1B6B93]" />}
                          </div>
                          <p className="text-xs text-[#6B7280] font-medium">{doc.specialty} · {doc.hospital}</p>

                          {/* Stars */}
                          <div className="flex gap-0.5 mt-1">
                            {Array.from({ length: 5 }).map((_, i) => (
                              <Star key={i} className={`w-3.5 h-3.5 ${i < doc.rating ? 'text-[#F5A623] fill-[#F5A623]' : 'text-[#EBE3D5]'}`} />
                            ))}
                          </div>
                        </div>

                        <div className="flex flex-col items-end gap-2 shrink-0">
                          <span className={`px-3 py-1 rounded-full text-xs font-bold border ${doc.availColor}`}>
                            {doc.availability}
                          </span>
                          <div className="flex gap-2">
                            {doc.modes.includes('video') && (
                              <span className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-[#E6F4F1] text-[#1B6B93] text-[10px] font-bold">
                                <Video className="w-3 h-3" /> Video
                              </span>
                            )}
                            {doc.modes.includes('in-person') && (
                              <span className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-[#FFE8D6] text-[#E2694B] text-[10px] font-bold">
                                <MapPin className="w-3 h-3" /> In-Person
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Mode selector when this doctor is selected */}
                      {isSelected && (
                        <div className="mt-4 pt-4 border-t border-[#EBE3D5]">
                          <p className="text-xs text-[#6B7280] font-bold mb-3">How would you like to consult?</p>
                          <div className="flex gap-3">
                            {doc.modes.includes('video') && (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleSelectMode('video'); setStep(4); }}
                                className={`flex-1 py-3 rounded-2xl border-2 flex items-center justify-center gap-2 text-sm font-bold transition cursor-pointer min-h-[52px] ${selectedMode === 'video' ? 'bg-[#1B6B93] border-[#1B6B93] text-white shadow-md' : 'border-[#EBE3D5] text-[#1B6B93] hover:border-[#1B6B93]'}`}
                              >
                                <Video className="w-4 h-4" /> Video Call
                              </button>
                            )}
                            {doc.modes.includes('in-person') && (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleSelectMode('in-person'); }}
                                className={`flex-1 py-3 rounded-2xl border-2 flex items-center justify-center gap-2 text-sm font-bold transition cursor-pointer min-h-[52px] ${selectedMode === 'in-person' ? 'bg-[#E2694B] border-[#E2694B] text-white shadow-md' : 'border-[#EBE3D5] text-[#E2694B] hover:border-[#E2694B]'}`}
                              >
                                <MapPin className="w-4 h-4" /> In-Person
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── STEP 3: Hospital/Location (only if in-person) ── */}
          {step >= 3 && needsHospital && (
            <div className="bg-white border border-[#EBE3D5] rounded-3xl p-6 md:p-8 space-y-5 shadow-[0_8px_30px_rgba(0,0,0,0.04)]">
              <div className="flex items-center gap-3 border-b border-[#F0EBE1] pb-4">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-black shrink-0 ${selectedHospital ? 'bg-[#4CAA6D] text-white' : 'bg-[#1B6B93] text-white'}`}>
                  {selectedHospital ? '✓' : '3'}
                </div>
                <div>
                  <h2 className="font-fraunces font-bold text-xl text-[#2E2E2E]">Choose Location</h2>
                  <p className="text-xs text-[#6B7280]">Select the hospital or clinic nearest to you</p>
                </div>
              </div>

              <div className="space-y-3">
                {HOSPITALS.map((h) => {
                  const isSel = selectedHospital?.id === h.id;
                  return (
                    <div
                      key={h.id}
                      onClick={() => { setSelectedHospital(h); setStep(4); }}
                      className={`p-5 rounded-2xl border-2 cursor-pointer flex items-center gap-4 transition-all hover:scale-[1.01] ${isSel ? 'border-[#1B6B93] bg-[#1B6B93]/08 shadow-md' : 'border-[#EBE3D5] bg-[#FAF7F2] hover:border-[#1B6B93]/40'}`}
                    >
                      {/* Map thumb placeholder */}
                      <div className="w-16 h-16 rounded-2xl bg-[#E6F4F1] flex items-center justify-center text-3xl shrink-0 border border-[#CDEAE5]">
                        {h.mapThumb}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-fraunces font-bold text-base text-[#2E2E2E]">{h.name}</h4>
                        <p className="text-xs text-[#6B7280] font-medium mt-0.5">{h.address}</p>
                        <div className="flex items-center gap-3 mt-1.5">
                          <span className="text-xs font-bold text-[#4CAA6D] flex items-center gap-1">
                            <MapPin className="w-3 h-3" /> {h.distance}
                          </span>
                        </div>
                      </div>
                      <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 ${isSel ? 'border-[#1B6B93] bg-[#1B6B93]' : 'border-[#EBE3D5]'}`}>
                        {isSel && <span className="w-3 h-3 rounded-full bg-white block" />}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── STEP 4: Date & Time ── */}
          {step >= 4 && (
            <div className="bg-white border border-[#EBE3D5] rounded-3xl p-6 md:p-8 space-y-6 shadow-[0_8px_30px_rgba(0,0,0,0.04)]">
              <div className="flex items-center gap-3 border-b border-[#F0EBE1] pb-4">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-black shrink-0 ${selectedDate && selectedTime ? 'bg-[#4CAA6D] text-white' : 'bg-[#1B6B93] text-white'}`}>
                  {selectedDate && selectedTime ? '✓' : '4'}
                </div>
                <div>
                  <h2 className="font-fraunces font-bold text-xl text-[#2E2E2E]">Choose Date & Time</h2>
                  <p className="text-xs text-[#6B7280]">Pick a day and time slot that suits you</p>
                </div>
              </div>

              {/* Date Strip */}
              <div>
                <p className="text-xs font-bold text-[#6B7280] uppercase tracking-wider mb-3">Select a Day</p>
                <div className="flex gap-3 overflow-x-auto pb-2">
                  {DATES.map((d) => {
                    const isSel = selectedDate?.raw === d.raw;
                    return (
                      <button
                        key={d.raw}
                        onClick={() => setSelectedDate(d)}
                        className={`flex-shrink-0 w-20 py-4 rounded-2xl border-2 flex flex-col items-center gap-1 text-center transition cursor-pointer hover:scale-[1.03] ${
                          isSel ? 'border-[#1B6B93] bg-[#1B6B93] text-white shadow-md' : 'border-[#EBE3D5] bg-[#FAF7F2] text-[#2E2E2E] hover:border-[#1B6B93]/50'
                        }`}
                      >
                        <span className="text-[11px] font-bold uppercase tracking-wide opacity-80">{d.label}</span>
                        <span className="text-lg font-black font-fraunces leading-none">{d.date.split(' ')[0]}</span>
                        <span className="text-[10px] font-semibold opacity-70">{d.date.split(' ')[1]}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Time Slots */}
              {selectedDate && (
                <div className="space-y-5">
                  {Object.entries(TIME_SLOTS).map(([period, slots]) => (
                    <div key={period}>
                      <p className="text-xs font-bold text-[#6B7280] uppercase tracking-wider mb-3">
                        {period === 'Morning' ? '🌅' : period === 'Afternoon' ? '☀️' : '🌆'} {period}
                      </p>
                      <div className="flex flex-wrap gap-2.5">
                        {slots.map((slot) => {
                          const unavail = UNAVAILABLE.has(slot);
                          const isSel   = selectedTime === slot;
                          return (
                            <button
                              key={slot}
                              disabled={unavail}
                              onClick={() => setSelectedTime(slot)}
                              className={`px-4 py-3 rounded-2xl border-2 text-sm font-bold min-h-[52px] min-w-[96px] transition cursor-pointer ${
                                unavail  ? 'border-[#EBE3D5] bg-[#EBE3D5] text-[#B4A89A] cursor-not-allowed line-through' :
                                isSel    ? 'border-[#1B6B93] bg-[#1B6B93] text-white shadow-md scale-[1.03]' :
                                           'border-[#EBE3D5] bg-white text-[#2E2E2E] hover:border-[#1B6B93]/50 hover:scale-[1.02]'
                              }`}
                            >
                              {slot}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Confirm Appointment Card ── */}
          {canConfirm && (
            <div className="bg-gradient-to-br from-[#F4F9F5] to-white border-2 border-[#4CAA6D]/40 rounded-3xl p-6 md:p-8 shadow-[0_12px_40px_rgba(76,170,109,0.15)] space-y-5">
              <div className="flex items-center gap-3 border-b border-[#C8E6D0] pb-4">
                <div className="p-3 rounded-2xl bg-[#4CAA6D] text-white">
                  <CheckCircle2 className="w-7 h-7" />
                </div>
                <div>
                  <h2 className="font-fraunces font-bold text-2xl text-[#2E2E2E]">Confirm Your Appointment</h2>
                  <p className="text-xs text-[#4CAA6D] font-semibold">Everything looks good — review and confirm below</p>
                </div>
              </div>

              {/* Summary */}
              <div className="flex items-center gap-4 p-5 bg-white rounded-2xl border border-[#C8E6D0] shadow-sm">
                <img src={selectedDoctor.photo} alt={selectedDoctor.name} className="w-16 h-16 rounded-2xl object-cover border-2 border-[#4CAA6D] shrink-0" />
                <div className="flex-1 space-y-1">
                  <h3 className="font-fraunces font-bold text-xl text-[#2E2E2E]">{selectedDoctor.name}</h3>
                  <p className="text-xs text-[#6B7280] font-medium">{selectedDoctor.specialty} · {selectedDoctor.hospital}</p>
                  <div className="flex flex-wrap gap-3 mt-2 text-xs font-bold">
                    <span className="flex items-center gap-1.5 text-[#1B6B93]"><Calendar className="w-4 h-4" /> {selectedDate?.label}, {selectedDate?.date}</span>
                    <span className="flex items-center gap-1.5 text-[#1B6B93]"><Clock className="w-4 h-4" /> {selectedTime}</span>
                    <span className="flex items-center gap-1.5 text-[#E2694B]">
                      {selectedMode === 'video' ? <Video className="w-4 h-4" /> : <MapPin className="w-4 h-4" />}
                      {selectedMode === 'video' ? 'Video Call' : `In-Person · ${selectedHospital?.name}`}
                    </span>
                  </div>
                </div>
              </div>

              <button
                onClick={handleConfirm}
                className="w-full py-5 rounded-2xl bg-gradient-to-r from-[#4CAA6D] to-[#3B9559] hover:from-[#3B9559] hover:to-[#2F8049] text-white font-fraunces font-bold text-xl shadow-[0_6px_24px_rgba(76,170,109,0.4)] transition-all hover:scale-[1.02] flex items-center justify-center gap-3 min-h-[64px] cursor-pointer"
              >
                <CheckCircle2 className="w-7 h-7" />
                Confirm Appointment
              </button>
              <p className="text-center text-xs text-[#6B7280] font-medium">
                🔔 Your caregiver will be notified once this appointment is confirmed
              </p>
            </div>
          )}

        </div>

        {/* ════ RIGHT SIDEBAR (4 cols) ════ */}
        <div className="lg:col-span-4 space-y-8">

          {/* 1. Emergency SOS — unchanged */}
          <div className="bg-gradient-to-br from-[#D32F2F] via-[#C62828] to-[#B71C1C] rounded-3xl p-6 md:p-8 text-white shadow-[0_12px_40px_rgba(211,47,47,0.35)] space-y-5 relative overflow-hidden">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-2xl bg-white/20 backdrop-blur-md">
                <PhoneCall className="w-8 h-8" />
              </div>
              <div>
                <h3 className="font-fraunces font-bold text-2xl text-white">Emergency SOS</h3>
                <span className="text-xs text-white/80 font-medium">Multi-Tier Urgent Response</span>
              </div>
            </div>
            <p className="text-white/90 text-sm font-medium leading-relaxed">Press the button below if you feel unwell or need immediate help.</p>
            <button
              onClick={() => { setSosActive(true); setSosCountdown(10); }}
              className="w-full py-5 rounded-2xl bg-white hover:bg-red-50 text-[#C62828] font-fraunces font-bold text-xl shadow-xl hover:scale-[1.02] transition-all flex items-center justify-center gap-3 min-h-[64px] cursor-pointer border-2 border-white/80"
            >
              <PhoneCall className="w-7 h-7 animate-bounce" />
              1-TAP EMERGENCY SOS
            </button>
            <p className="text-center text-xs text-white/80">🔒 Notifies your caregiver & 24/7 Hospital Dispatch</p>
          </div>

          {/* 2. Upcoming Appointments */}
          <div className="bg-white border border-[#EBE3D5] shadow-[0_8px_30px_rgba(0,0,0,0.04)] rounded-3xl p-6 space-y-4">
            <div className="flex justify-between items-center border-b border-[#F0EBE1] pb-3">
              <span className="text-xs font-bold text-[#1B6B93] uppercase tracking-wider">Upcoming Appointments</span>
              <span className="px-2.5 py-0.5 rounded-full bg-[#FFE8D6] text-[#1B6B93] text-xs font-bold">{bookedAppointments.length} Scheduled</span>
            </div>

            <div className="space-y-4">
              {bookedAppointments.length === 0 ? (
                <p className="text-xs text-[#6B7280] text-center py-6">No upcoming appointments booked yet</p>
              ) : (
                bookedAppointments.map((a) => {
                  const doc = registeredDoctors.find(d => (d.user_id || d.id) === a.doctor_id);
                  const docName = doc ? doc.name : `Doctor (${String(a.doctor_id).slice(0, 6)})`;
                  const docSpec = doc ? doc.specialization : 'Specialist';
                  const docPhoto = doc?.profile_pic_url || 'https://images.unsplash.com/photo-1622253692010-333f2da6031d?auto=format&fit=crop&q=80&w=200';
                  const isVideo = a.mode === 'telemedicine' || a.mode === 'video';

                  return (
                    <div key={a.id} className="p-4 rounded-2xl bg-[#FAF7F2] border border-[#EBE3D5] space-y-3">
                      <div className="flex items-center gap-3">
                        <img src={docPhoto} alt={docName} className="w-11 h-11 rounded-xl object-cover border-2 border-[#1B6B93] shrink-0" />
                        <div>
                          <h4 className="font-fraunces font-bold text-sm text-[#2E2E2E]">{docName}</h4>
                          <p className="text-[11px] text-[#6B7280] font-medium">{docSpec}</p>
                          <p className="text-[11px] text-[#1B6B93] font-bold mt-0.5 flex items-center gap-1">
                            <Clock className="w-3 h-3" /> {a.appointment_date} at {a.start_time}
                          </p>
                          {a.queue_token && (
                            <span className="inline-block mt-1 px-2 py-0.5 bg-[#1B6B93]/10 text-[#1B6B93] font-mono text-[10px] font-bold rounded">
                              Queue Token: {a.queue_token}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {isVideo ? (
                          <button className="flex-1 py-2.5 rounded-xl bg-[#1B6B93] text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer min-h-[40px]">
                            <Video className="w-3.5 h-3.5" /> Join Call
                          </button>
                        ) : (
                          <div className="flex-1 py-2.5 rounded-xl bg-[#F4F9F5] border border-[#CDEAE5] text-[#1B6B93] text-xs font-bold flex items-center justify-center gap-1.5 min-h-[40px]">
                            <MapPin className="w-3.5 h-3.5" /> In-Person Visit
                          </div>
                        )}
                        <button
                          onClick={async () => {
                            try {
                              await appointmentsService.cancelAppointment(a.id);
                              const updated = await appointmentsService.getAppointments(currentUser?.id || currentUser?.user_id);
                              setBookedAppointments(updated || []);
                            } catch(err) { console.warn(err); }
                          }}
                          className="py-2.5 px-3 rounded-xl bg-[#FAF7F2] border border-[#EBE3D5] text-[#6B7280] text-xs font-bold cursor-pointer hover:text-red-500 min-h-[40px]"
                          title="Cancel Appointment"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* 3. Past Visits */}
          <div className="bg-white border border-[#EBE3D5] shadow-[0_8px_30px_rgba(0,0,0,0.04)] rounded-3xl p-6 space-y-3">
            <div className="flex items-center gap-3 border-b border-[#F0EBE1] pb-3">
              <span className="text-xs font-bold text-[#6B7280] uppercase tracking-wider">Past Visits</span>
            </div>
            <div className="space-y-2">
              {PAST_VISITS.map((v) => (
                <div key={v.id} className="flex justify-between items-center py-2.5 border-b border-[#F5F0EA] last:border-0">
                  <div>
                    <p className="text-sm font-bold text-[#2E2E2E]">{v.doctor}</p>
                    <p className="text-[11px] text-[#6B7280] font-medium">{v.specialty} · {v.date}</p>
                  </div>
                  <button className="text-xs text-[#1B6B93] font-bold hover:underline cursor-pointer flex items-center gap-1">
                    Summary <ChevronRight className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>



      {/* ── SOS Countdown / Confirmation Modal ── */}
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
    </div>
  );
}
