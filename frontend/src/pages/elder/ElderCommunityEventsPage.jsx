import React, { useState, useEffect } from 'react';
import { sendSos } from '../../utils/sendSos';
import broadcastRealtimeEvent from '../../utils/realtimeBus';
import {
  PartyPopper,
  MapPin,
  Clock,
  Calendar,
  Users,
  Heart,
  Music,
  BookOpen,
  Dumbbell,
  ChevronRight,
  CheckCircle2,
  PhoneCall,
  Bot,
  X,
  Star,
  Sun,
  Leaf,
  Trash2,
  ExternalLink,
  Lightbulb,
  Sparkles,
  Info,
  CheckSquare,
  Square,
  ArrowUpRight
} from 'lucide-react';

const EVENTS = [
  {
    id: 'evt-flower-arrangements',
    title: 'Virtual Class: Flower Arrangements',
    category: 'Hobby',
    categoryIcon: BookOpen,
    categoryColor: 'bg-purple-50 text-purple-700 border-purple-200',
    tag: 'Online Class',
    tagColor: 'bg-purple-100 text-purple-800 border-purple-300',
    image: '🌸',
    date: 'Oct 24, 2026',
    time: '10:00 AM - 11:30 AM EST',
    location: 'Online / Virtual (AARP Platform)',
    organizer: 'AARP Virtual Community Events',
    description: 'Join this interactive virtual workshop hosted by AARP to master the art of floral design, flower care, and creative DIY bouquet styling from the comfort of home.',
    spots: 18,
    totalSpots: 50,
    url: 'https://www.aarp.org/events/details.virtual-class-flower-arrangements.b5nhqvrpp8y/?intcmp=EVENTS-HUB-BTN-CLK-CAROUSEL-.virtual-class-flower-arrangements'
  },
  {
    id: 'evt-jodhpur-jaisalmer',
    title: 'Jodhpur & Jaisalmer New Year Trip Package',
    category: 'Entertainment',
    categoryIcon: Music,
    categoryColor: 'bg-amber-50 text-amber-700 border-amber-200',
    tag: 'Holiday Tour',
    tagColor: 'bg-amber-100 text-amber-800 border-amber-300',
    image: '🐫',
    date: 'Dec 29, 2026 - Jan 02, 2027',
    time: '6:00 AM Departure',
    location: 'Vadodara, Gujarat → Jodhpur & Jaisalmer',
    organizer: 'Gujarat Cultural Expeditions',
    description: 'A specially curated, senior-friendly travel package departing from Vadodara to Rajasthan. Experience desert safari camping, historic fort tours, folk music, and New Year celebrations.',
    spots: 8,
    totalSpots: 25,
    url: 'https://www.eventbrite.com/e/jodhpur-jaisalmer-new-year-trip-package-from-vadodara-gujrat-2026-2027-tickets-1990930710349'
  },
  {
    id: 'evt-singapore-bali',
    title: 'Singapore to Bali: An Indonesian Island Expedition',
    category: 'Wellness',
    categoryIcon: Leaf,
    categoryColor: 'bg-teal-50 text-teal-700 border-teal-200',
    tag: 'Ocean Voyage',
    tagColor: 'bg-teal-100 text-teal-800 border-teal-300',
    image: '🚢',
    date: 'Nov 12, 2026 - Nov 26, 2026',
    time: '9:00 AM Boarding',
    location: 'Singapore → Indonesian Archipelago → Bali',
    organizer: 'Road Scholar Educational Travel',
    description: 'Embark on an inspiring educational & wellness expedition through the Indonesian islands. Explore vibrant coral reefs, ancient temples, traditional music, and serene island retreats.',
    spots: 5,
    totalSpots: 20,
    url: 'https://www.roadscholar.org/find-an-adventure/25671/Singapore-to-Bali-An-Indonesian-Island-Expedition'
  }
];

const CATEGORIES = ['All', 'Wellness', 'Fitness', 'Hobby', 'Entertainment', 'Health Talk', 'Social'];

const DID_YOU_KNOW_ITEMS = [
  {
    icon: Heart,
    color: 'bg-emerald-50 text-emerald-600 border-emerald-200',
    title: '40% Isolation Reduction',
    description: 'Senior citizens participating in weekly group activities report up to 40% lower feelings of loneliness and improved mood stability.'
  },
  {
    icon: Sparkles,
    color: 'bg-purple-50 text-purple-600 border-purple-200',
    title: 'Cognitive Vitality',
    description: 'Engaging in book clubs, music sessions, and social interactive games helps preserve memory recall and reduces dementia risks.'
  },
  {
    icon: Dumbbell,
    color: 'bg-amber-50 text-amber-600 border-amber-200',
    title: 'Balance & Fall Prevention',
    description: 'Regular gentle stretching or morning yoga enhances joint flexibility, balance, and leg strength by 25% within 4 weeks.'
  },
  {
    icon: Lightbulb,
    color: 'bg-blue-50 text-blue-600 border-blue-200',
    title: 'Immune System Boost',
    description: 'Laughter, music, and pleasant conversation lower cortisol levels and strengthen natural immune defences in older adults.'
  }
];

export default function ElderCommunityEventsPage({ currentUser }) {
  const [activeCategory, setActiveCategory] = useState('All');
  const [registrations, setRegistrations]   = useState({});
  
  // Popup Modals state
  const [myRegModalOpen, setMyRegModalOpen] = useState(false);
  const [didYouKnowModalOpen, setDidYouKnowModalOpen] = useState(false);
  const [selectedEventDetails, setSelectedEventDetails] = useState(null);

  // Selection state inside My Registrations popup
  const [selectedRegIds, setSelectedRegIds] = useState([]);

  // Toast / Emergency / AI companion state
  const [toastMessage, setToastMessage]     = useState(null);
  const [sosActive, setSosActive]           = useState(false);
  const [sosCountdown, setSosCountdown]     = useState(10);
  const [sosSentConfirmed, setSosSentConfirmed] = useState(false);
  const [chatOpen, setChatOpen]             = useState(false);
  const [messages, setMessages]             = useState([
    { role: 'assistant', text: `Hello ${currentUser?.name ? currentUser.name.split(' ')[0] : 'there'}! I can help you find events that match your interests and health needs. What kind of activity are you looking for today?` }
  ]);
  const [inputMsg, setInputMsg] = useState('');

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
    showToast('Emergency SOS dispatched to Caretaker & Hospital!');
  };

  const filtered = EVENTS.filter(e => activeCategory === 'All' || e.category === activeCategory);
  const registeredEvents = EVENTS.filter(e => registrations[e.id]);
  const myCount = registeredEvents.length;

  function showToast(msg) {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  }

  function handleRegister(event) {
    setRegistrations(prev => ({ ...prev, [event.id]: true }));
    showToast(`You're registered for "${event.title}"! 🎉`);
  }

  function handleUnregisterSingle(eventId) {
    const ev = EVENTS.find(e => e.id === eventId);
    setRegistrations(prev => {
      const next = { ...prev };
      delete next[eventId];
      return next;
    });
    setSelectedRegIds(prev => prev.filter(id => id !== eventId));
    showToast(`Unregistered from "${ev?.title || 'event'}"`);
  }

  function handleBulkDeleteRegistrations() {
    if (selectedRegIds.length === 0) return;
    setRegistrations(prev => {
      const next = { ...prev };
      selectedRegIds.forEach(id => delete next[id]);
      return next;
    });
    showToast(`Removed ${selectedRegIds.length} event registration(s)`);
    setSelectedRegIds([]);
  }

  function toggleSelectAllRegs() {
    if (selectedRegIds.length === registeredEvents.length) {
      setSelectedRegIds([]);
    } else {
      setSelectedRegIds(registeredEvents.map(e => e.id));
    }
  }

  function toggleSelectRegItem(id) {
    setSelectedRegIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  }

  function handleRegisterAndRedirect(event) {
    handleRegister(event);
    if (event.url) {
      setTimeout(() => {
        window.open(event.url, '_blank', 'noopener,noreferrer');
      }, 600);
    }
  }

  function handleSendChat(e) {
    e.preventDefault();
    if (!inputMsg.trim()) return;
    setMessages(prev => [
      ...prev,
      { role: 'user', text: inputMsg },
      { role: 'assistant', text: `Based on your interest in "${inputMsg}", I will look for events that match your preferences. Check back soon for upcoming community events near you!` }
    ]);
    setInputMsg('');
  }

  return (
    <div className="space-y-8 bg-[#FAF7F2] text-[#2E2E2E] font-inter min-h-screen pb-16">

      {/* Floating Success Toast */}
      {toastMessage && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] bg-[#4CAA6D] text-white px-8 py-4 rounded-2xl shadow-2xl flex items-center gap-3 font-semibold animate-bounce max-w-md w-full">
          <CheckCircle2 className="w-6 h-6 shrink-0" />
          <span className="flex-1 text-sm">{toastMessage}</span>
          <button onClick={() => setToastMessage(null)} className="p-1 hover:bg-white/20 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Header Banner */}
      <div className="bg-gradient-to-br from-[#FFE8D6] via-[#FFF3E5] to-[#FCEFE3] border border-[#F5DFCD] shadow-[0_10px_30px_rgba(245,223,205,0.4)] rounded-3xl p-6 md:p-8 flex flex-wrap justify-between items-center gap-6">
        <div className="space-y-2 max-w-xl">
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-white/90 border border-[#F5DFCD] text-[#1B6B93] text-xs font-bold shadow-sm">
            <Sun className="w-4 h-4 text-[#F5A623]" />
            <span>Stay Connected & Active</span>
          </div>
          <h1 className="font-fraunces font-bold text-3xl md:text-4xl text-[#2E2E2E] tracking-tight leading-tight">
            Community Events 🎉
          </h1>
          <p className="text-base text-[#525252] font-medium leading-relaxed">
            Events, activities, and gatherings curated just for you, {currentUser?.name ? currentUser.name.split(' ')[0] : 'there'}.
          </p>
        </div>
        
        {/* Quick Emergency Call Trigger */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => { setSosActive(true); setSosCountdown(10); }}
            className="px-5 py-3.5 bg-gradient-to-r from-red-600 to-red-700 text-white font-bold rounded-2xl shadow-md hover:shadow-lg hover:scale-105 transition flex items-center gap-2 text-xs border border-red-500 cursor-pointer"
          >
            <PhoneCall className="w-4 h-4 animate-bounce" /> 1-Tap SOS
          </button>
          <div className="p-4 rounded-3xl bg-gradient-to-tr from-[#1B6B93] to-[#2E7D8C] shadow-xl shrink-0 border-2 border-white/60">
            <PartyPopper className="w-10 h-10 text-[#FFE8D6]" />
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════
          2 RECTANGULAR BOXES ABOVE "UPCOMING NEAR YOU"
          1) My Registrations
          2) Did You Know ?
      ══════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* RECTANGULAR BOX 1: MY REGISTRATIONS */}
        <div
          onClick={() => setMyRegModalOpen(true)}
          className="group relative bg-gradient-to-br from-white via-[#F4F9F5] to-[#EBF6EE] border-2 border-[#C8E6D0] hover:border-[#4CAA6D] rounded-3xl p-6 md:p-7 shadow-[0_8px_30px_rgba(76,170,109,0.12)] hover:shadow-[0_12px_40px_rgba(76,170,109,0.22)] transition-all cursor-pointer flex flex-col justify-between"
        >
          <div className="flex justify-between items-start">
            <div className="flex items-center gap-3.5">
              <div className="p-3.5 rounded-2xl bg-[#4CAA6D] text-white shadow-md group-hover:scale-110 transition-transform">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-[#4CAA6D]">Personal Dashboard</span>
                <h3 className="font-fraunces font-bold text-2xl text-[#2E2E2E] group-hover:text-[#4CAA6D] transition-colors">
                  My Registrations
                </h3>
              </div>
            </div>
            <span className="px-3.5 py-1.5 rounded-full bg-[#4CAA6D] text-white text-xs font-black shadow-sm">
              {myCount} Registered
            </span>
          </div>

          <div className="mt-5 pt-4 border-t border-[#D3ECD9] flex items-center justify-between">
            <p className="text-sm font-semibold text-[#4A5568]">
              {myCount > 0
                ? `${myCount} event${myCount > 1 ? 's' : ''} saved in your schedule`
                : 'No events registered yet'}
            </p>
            <div className="inline-flex items-center gap-1 text-xs font-bold text-[#4CAA6D] group-hover:translate-x-1 transition-transform">
              <span>View & Manage</span>
              <ChevronRight className="w-4 h-4" />
            </div>
          </div>
        </div>

        {/* RECTANGULAR BOX 2: DID YOU KNOW ? */}
        <div
          onClick={() => setDidYouKnowModalOpen(true)}
          className="group relative bg-gradient-to-br from-white via-[#FFF9F2] to-[#FFF1E0] border-2 border-[#FCDDBB] hover:border-[#F5A623] rounded-3xl p-6 md:p-7 shadow-[0_8px_30px_rgba(245,166,35,0.12)] hover:shadow-[0_12px_40px_rgba(245,166,35,0.22)] transition-all cursor-pointer flex flex-col justify-between"
        >
          <div className="flex justify-between items-start">
            <div className="flex items-center gap-3.5">
              <div className="p-3.5 rounded-2xl bg-[#F5A623] text-white shadow-md group-hover:scale-110 transition-transform">
                <Lightbulb className="w-7 h-7" />
              </div>
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-[#D98200]">Senior Health & Wellness</span>
                <h3 className="font-fraunces font-bold text-2xl text-[#2E2E2E] group-hover:text-[#D98200] transition-colors">
                  Did You Know ?
                </h3>
              </div>
            </div>
            <span className="px-3 py-1 rounded-full bg-[#FFF3E5] border border-[#FCDDBB] text-[#D98200] text-xs font-bold flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-[#F5A623]" /> Tips & Facts
            </span>
          </div>

          <div className="mt-5 pt-4 border-t border-[#FEEAD4] flex items-center justify-between">
            <p className="text-sm font-semibold text-[#525252] truncate max-w-[80%]">
              Seniors in community events report 40% lower loneliness! 🌿
            </p>
            <div className="inline-flex items-center gap-1 text-xs font-bold text-[#D98200] group-hover:translate-x-1 transition-transform">
              <span>Read Insights</span>
              <ChevronRight className="w-4 h-4" />
            </div>
          </div>
        </div>

      </div>


      {/* ══════════════════════════════════════════════════════════════
          UPCOMING NEAR YOU - CATEGORY FILTERS & SQUARE BOXES GRID
      ══════════════════════════════════════════════════════════════ */}
      <div className="space-y-6 pt-4">

        {/* Section Title & Category Filter Chips */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <h2 className="font-fraunces font-bold text-2xl text-[#2E2E2E]">Upcoming Near You</h2>

          <div className="flex gap-2 overflow-x-auto pb-1 max-w-full">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-4 py-2 rounded-2xl border-2 text-xs font-bold whitespace-nowrap transition cursor-pointer min-h-[40px] ${
                  activeCategory === cat
                    ? 'bg-[#1B6B93] border-[#1B6B93] text-white shadow-md'
                    : 'bg-white border-[#EBE3D5] text-[#525252] hover:border-[#1B6B93]/40'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Square Boxes Grid Layout (1 col sm, 2 col md, 3 col lg) */}
        {EVENTS.length === 0 ? (
          <div className="col-span-3 py-20 flex flex-col items-center justify-center bg-white border-2 border-dashed border-[#EBE3D5] rounded-3xl gap-5 text-center px-6">
            <div className="w-20 h-20 rounded-full bg-[#FAF7F2] border border-[#EBE3D5] flex items-center justify-center text-4xl shadow-sm">
              🎉
            </div>
            <div className="space-y-2">
              <h3 className="font-fraunces font-bold text-2xl text-[#2E2E2E]">No Events Yet</h3>
              <p className="text-sm text-[#6B7280] font-medium max-w-sm mx-auto leading-relaxed">
                Community events and activities near you will appear here once they are added. Check back soon!
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {EVENTS.filter(e => activeCategory === 'All' || e.category === activeCategory).map((event) => {
              const isRegistered = !!registrations[event.id];
              const CatIcon = event.categoryIcon;

              return (
                <div
                  key={event.id}
                  className={`group relative bg-white border-2 rounded-3xl p-6 shadow-[0_6px_20px_rgba(0,0,0,0.04)] hover:shadow-xl transition-all duration-300 flex flex-col justify-between aspect-square ${
                    isRegistered ? 'border-[#4CAA6D]/60 bg-[#F4F9F5]/30' : 'border-[#EBE3D5] hover:border-[#1B6B93]'
                  }`}
                >
                  {/* Top Badge & Category */}
                  <div className="flex items-center justify-between gap-2">
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${event.categoryColor}`}>
                      <CatIcon className="w-3.5 h-3.5" /> {event.category}
                    </span>
                    {isRegistered ? (
                      <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-[#4CAA6D] text-white flex items-center gap-1 shadow-sm">
                        <CheckCircle2 className="w-3 h-3" /> Registered
                      </span>
                    ) : (
                      <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold border ${event.tagColor}`}>
                        {event.tag}
                      </span>
                    )}
                  </div>

                  {/* Main Content (Center) - Clickable to view details */}
                  <div
                    className="my-auto space-y-3 cursor-pointer"
                    onClick={() => setSelectedEventDetails(event)}
                  >
                    <div className="w-14 h-14 rounded-2xl bg-[#FAF7F2] border border-[#EBE3D5] flex items-center justify-center text-3xl shadow-sm group-hover:scale-110 transition-transform">
                      {event.image}
                    </div>

                    <h3 className="font-fraunces font-bold text-xl text-[#2E2E2E] line-clamp-2 leading-tight group-hover:text-[#1B6B93] transition-colors">
                      {event.title}
                    </h3>

                    <div className="space-y-1.5 text-xs text-[#6B7280] font-semibold">
                      <div className="flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-[#1B6B93] shrink-0" />
                        <span>{event.date} · {event.time}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-[#E2694B] shrink-0" />
                        <span className="truncate">{event.location}</span>
                      </div>
                    </div>
                  </div>

                  {/* Bottom Action Buttons */}
                  <div className="flex items-center gap-2 mt-2">
                    <button
                      onClick={() => setSelectedEventDetails(event)}
                      className="flex-1 py-3 px-3 rounded-2xl bg-[#1B6B93]/10 hover:bg-[#1B6B93] text-[#1B6B93] hover:text-white font-bold text-xs transition-all flex items-center justify-center gap-1.5 border border-[#1B6B93]/20 cursor-pointer min-h-[44px]"
                    >
                      <span>View Details</span>
                      <ArrowUpRight className="w-4 h-4" />
                    </button>
                    <a
                      href={event.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRegister(event);
                      }}
                      className="py-3 px-3.5 rounded-2xl bg-[#4CAA6D] hover:bg-[#3d915a] text-white font-bold text-xs transition-all flex items-center justify-center gap-1.5 shadow-md hover:scale-105 cursor-pointer shrink-0 min-h-[44px]"
                      title="Register & Redirect to Event Page"
                    >
                      <span>Join Event</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>


      {/* ══════════════════════════════════════════════════════════════
          POPUP MODAL 1: MY REGISTRATIONS (WITH MULTI-DELETE & SINGLE DELETE)
      ══════════════════════════════════════════════════════════════ */}
      {myRegModalOpen && (
        <div className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl border border-[#EBE3D5] overflow-hidden animate-in fade-in zoom-in duration-200">
            
            {/* Modal Header */}
            <div className="p-6 border-b border-[#F0EBE1] bg-[#FAF7F2] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-2xl bg-[#4CAA6D] text-white">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-fraunces font-bold text-2xl text-[#2E2E2E]">My Event Registrations</h3>
                  <p className="text-xs text-[#6B7280] font-medium">Manage and view your upcoming registered activities</p>
                </div>
              </div>
              <button
                onClick={() => setMyRegModalOpen(false)}
                className="p-2 rounded-full hover:bg-gray-200 text-[#525252] transition cursor-pointer"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Selection Toolbar (if registered events exist) */}
            {registeredEvents.length > 0 && (
              <div className="px-6 py-3 bg-[#F4F9F5] border-b border-[#C8E6D0] flex items-center justify-between text-xs font-semibold text-[#4A5568]">
                <button
                  onClick={toggleSelectAllRegs}
                  className="flex items-center gap-2 text-[#1B6B93] hover:underline cursor-pointer"
                >
                  {selectedRegIds.length === registeredEvents.length ? (
                    <CheckSquare className="w-4 h-4 text-[#4CAA6D]" />
                  ) : (
                    <Square className="w-4 h-4 text-gray-400" />
                  )}
                  <span>Select All ({registeredEvents.length})</span>
                </button>

                {selectedRegIds.length > 0 && (
                  <button
                    onClick={handleBulkDeleteRegistrations}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold shadow-sm transition cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete Selected ({selectedRegIds.length})</span>
                  </button>
                )}
              </div>
            )}

            {/* Registered Events List Body */}
            <div className="p-6 overflow-y-auto flex-1 space-y-4">
              {registeredEvents.length === 0 ? (
                <div className="text-center py-12 space-y-3">
                  <div className="w-16 h-16 rounded-full bg-[#FAF7F2] mx-auto flex items-center justify-center text-3xl">
                    🗓️
                  </div>
                  <h4 className="font-fraunces font-bold text-lg text-[#2E2E2E]">No Registrations Found</h4>
                  <p className="text-xs text-[#9CA3AF] max-w-sm mx-auto">
                    You haven't joined any events yet. Explore the square event boxes below and click "View Details & Register"!
                  </p>
                </div>
              ) : (
                registeredEvents.map((ev) => {
                  const isChecked = selectedRegIds.includes(ev.id);
                  return (
                    <div
                      key={ev.id}
                      className={`p-4 rounded-2xl border-2 transition-all flex items-center justify-between gap-4 ${
                        isChecked ? 'border-red-300 bg-red-50/40' : 'border-[#EBE3D5] bg-[#FAF7F2] hover:border-[#1B6B93]/40'
                      }`}
                    >
                      <div className="flex items-center gap-3.5 min-w-0">
                        {/* Multi-select Checkbox */}
                        <button
                          onClick={() => toggleSelectRegItem(ev.id)}
                          className="text-[#1B6B93] cursor-pointer shrink-0"
                        >
                          {isChecked ? (
                            <CheckSquare className="w-5 h-5 text-red-600" />
                          ) : (
                            <Square className="w-5 h-5 text-gray-400" />
                          )}
                        </button>

                        <span className="text-3xl shrink-0">{ev.image}</span>

                        <div className="min-w-0">
                          <h4 className="font-bold text-sm text-[#2E2E2E] truncate">{ev.title}</h4>
                          <div className="flex flex-wrap gap-2 text-xs text-[#6B7280] font-medium mt-0.5">
                            <span className="flex items-center gap-1">
                              <Calendar className="w-3 h-3 text-[#1B6B93]" /> {ev.date}
                            </span>
                            <span>•</span>
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3 text-[#1B6B93]" /> {ev.time}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {ev.url && (
                          <a
                            href={ev.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-2.5 rounded-xl bg-[#1B6B93]/10 hover:bg-[#1B6B93] text-[#1B6B93] hover:text-white transition cursor-pointer flex items-center gap-1 text-xs font-bold"
                            title="Open Official Event Page"
                          >
                            <span>Open</span>
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        )}
                        {/* Single Unregister / Delete Action */}
                        <button
                          onClick={() => handleUnregisterSingle(ev.id)}
                          className="p-2.5 rounded-xl bg-red-100 hover:bg-red-200 text-red-700 transition cursor-pointer"
                          title="Remove Registration"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-[#F0EBE1] bg-[#FAF7F2] text-right">
              <button
                onClick={() => setMyRegModalOpen(false)}
                className="px-6 py-2.5 rounded-2xl bg-[#1B6B93] text-white font-bold text-xs hover:bg-[#155373] transition cursor-pointer"
              >
                Close
              </button>
            </div>

          </div>
        </div>
      )}


      {/* ══════════════════════════════════════════════════════════════
          POPUP MODAL 2: DID YOU KNOW ? (SENIOR HEALTH & TRIVIA)
      ══════════════════════════════════════════════════════════════ */}
      {didYouKnowModalOpen && (
        <div className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl border border-[#FCDDBB] overflow-hidden animate-in fade-in zoom-in duration-200">
            
            {/* Header */}
            <div className="p-6 border-b border-[#FEEAD4] bg-[#FFF9F2] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-2xl bg-[#F5A623] text-white">
                  <Lightbulb className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-fraunces font-bold text-2xl text-[#2E2E2E]">Did You Know ?</h3>
                  <p className="text-xs text-[#D98200] font-bold">Scientific & Health Benefits of Community Engagement</p>
                </div>
              </div>
              <button
                onClick={() => setDidYouKnowModalOpen(false)}
                className="p-2 rounded-full hover:bg-gray-200 text-[#525252] transition cursor-pointer"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Content List */}
            <div className="p-6 overflow-y-auto flex-1 space-y-4">
              {DID_YOU_KNOW_ITEMS.map((item, idx) => {
                const ItemIcon = item.icon;
                return (
                  <div
                    key={idx}
                    className={`p-5 rounded-2xl border-2 ${item.color} flex items-start gap-4 shadow-sm`}
                  >
                    <div className="p-3 rounded-xl bg-white shadow-sm shrink-0 mt-0.5">
                      <ItemIcon className="w-6 h-6" />
                    </div>
                    <div className="space-y-1">
                      <h4 className="font-fraunces font-bold text-base text-[#2E2E2E]">{item.title}</h4>
                      <p className="text-xs text-[#4A5568] leading-relaxed font-medium">{item.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-[#FEEAD4] bg-[#FFF9F2] text-right">
              <button
                onClick={() => setDidYouKnowModalOpen(false)}
                className="px-6 py-2.5 rounded-2xl bg-[#F5A623] hover:bg-[#D98200] text-white font-bold text-xs transition cursor-pointer"
              >
                Got It, Thanks!
              </button>
            </div>

          </div>
        </div>
      )}


      {/* ══════════════════════════════════════════════════════════════
          POPUP MODAL 3: EVENT DETAILS & REGISTER NOW BUTTON
      ══════════════════════════════════════════════════════════════ */}
      {selectedEventDetails && (
        <div className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-[#EBE3D5] overflow-hidden animate-in fade-in zoom-in duration-200">
            
            {/* Header / Hero */}
            <div className="p-6 bg-gradient-to-r from-[#1B6B93] to-[#2E7D8C] text-white relative">
              <button
                onClick={() => setSelectedEventDetails(null)}
                className="absolute top-4 right-4 p-2 rounded-full bg-white/20 hover:bg-white/30 text-white transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center text-4xl shadow-inner shrink-0">
                  {selectedEventDetails.image}
                </div>
                <div>
                  <span className="px-3 py-0.5 rounded-full text-[11px] font-bold bg-white/20 backdrop-blur-md text-white inline-block mb-1">
                    {selectedEventDetails.category}
                  </span>
                  <h3 className="font-fraunces font-bold text-2xl leading-tight">
                    {selectedEventDetails.title}
                  </h3>
                </div>
              </div>
            </div>

            {/* Details Content */}
            <div className="p-6 overflow-y-auto flex-1 space-y-5">
              
              {/* Event Metadata Grid */}
              <div className="grid grid-cols-2 gap-3 p-4 rounded-2xl bg-[#FAF7F2] border border-[#EBE3D5]">
                <div className="space-y-1">
                  <span className="text-[11px] text-[#9CA3AF] font-bold uppercase">Date & Time</span>
                  <p className="text-xs font-bold text-[#2E2E2E] flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-[#1B6B93]" />
                    {selectedEventDetails.date}
                  </p>
                  <p className="text-[11px] text-[#6B7280] flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-[#1B6B93]" />
                    {selectedEventDetails.time}
                  </p>
                </div>

                <div className="space-y-1">
                  <span className="text-[11px] text-[#9CA3AF] font-bold uppercase">Location</span>
                  <p className="text-xs font-bold text-[#2E2E2E] flex items-center gap-1.5 truncate">
                    <MapPin className="w-3.5 h-3.5 text-[#E2694B]" />
                    {selectedEventDetails.location}
                  </p>
                  <span className="text-[11px] text-[#1B6B93] font-semibold">
                    Hosted by {selectedEventDetails.organizer}
                  </span>
                </div>
              </div>

              {/* Description */}
              <div className="space-y-2">
                <h4 className="font-fraunces font-bold text-base text-[#2E2E2E]">About This Event</h4>
                <p className="text-xs text-[#525252] font-medium leading-relaxed">
                  {selectedEventDetails.description}
                </p>
              </div>

              {/* Capacity & Spots Left */}
              <div className="space-y-1 pt-2 border-t border-[#F0EBE1]">
                <div className="flex justify-between items-center text-xs font-bold text-[#525252]">
                  <span>Available Seats</span>
                  <span className="text-[#1B6B93]">
                    {selectedEventDetails.spots} spots remaining of {selectedEventDetails.totalSpots}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-[#EBE3D5] overflow-hidden">
                  <div
                    className="h-full bg-[#4CAA6D] rounded-full"
                    style={{
                      width: `${100 - Math.round((selectedEventDetails.spots / selectedEventDetails.totalSpots) * 100)}%`
                    }}
                  />
                </div>
              </div>

            </div>

            {/* Footer with Register Now Button */}
            <div className="p-5 border-t border-[#F0EBE1] bg-[#FAF7F2] flex flex-col sm:flex-row gap-3 items-center justify-between">
              
              {/* Event Page External Link */}
              <a
                href={selectedEventDetails.url}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-bold text-[#1B6B93] hover:underline flex items-center gap-1"
              >
                <span>Visit Official Event Page</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>

              <div className="flex gap-2 w-full sm:w-auto">
                <button
                  onClick={() => setSelectedEventDetails(null)}
                  className="flex-1 sm:flex-initial px-5 py-3 rounded-2xl border border-[#EBE3D5] text-[#525252] font-bold text-xs hover:bg-gray-100 transition cursor-pointer min-h-[46px]"
                >
                  Close
                </button>

                {registrations[selectedEventDetails.id] ? (
                  <button
                    onClick={() => {
                      handleUnregisterSingle(selectedEventDetails.id);
                      setSelectedEventDetails(null);
                    }}
                    className="flex-1 sm:flex-initial px-6 py-3 rounded-2xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs transition cursor-pointer shadow-md min-h-[46px]"
                  >
                    Cancel Registration
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      handleRegisterAndRedirect(selectedEventDetails);
                      setSelectedEventDetails(null);
                    }}
                    className="flex-1 sm:flex-initial px-6 py-3 rounded-2xl bg-gradient-to-r from-[#1B6B93] to-[#2E7D8C] hover:from-[#155373] hover:to-[#235F6B] text-white font-bold text-xs transition shadow-md hover:scale-105 cursor-pointer flex items-center justify-center gap-2 min-h-[46px]"
                  >
                    <PartyPopper className="w-4 h-4" />
                    <span>Register Now</span>
                  </button>
                )}
              </div>

            </div>

          </div>
        </div>
      )}




      {/* SOS Modal */}
      {sosActive && (
        <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in">
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
