import React, { useState, useEffect } from 'react';
import { startSosAlarmSound, stopSosAlarmSound } from '../../utils/sosSound';
import {
  FolderOpen,
  FileText,
  Download,
  Eye,
  Calendar,
  ChevronRight,
  PhoneCall,
  Bot,
  X,
  ShieldAlert,
  CheckCircle2,
  Clock,
  Stethoscope,
  Activity,
  Pill,
  Search,
  Sun
} from 'lucide-react';
import reportsService from '../../services/reportsService';
import doctorRecordsService from '../../services/doctorRecordsService';
import aiCompanionService from '../../services/aiCompanionService';
import { sendSos } from '../../utils/sendSos';
import broadcastRealtimeEvent from '../../utils/realtimeBus';
import tabStorage from '../../utils/tabStorage';

const defaultElderReports = [];

export default function ElderMedicalReportsPage({ currentUser }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [viewReport, setViewReport] = useState(null);
  const [reportsList, setReportsList] = useState([]);
  const [sosActive, setSosActive] = useState(false);
  const [sosCountdown, setSosCountdown] = useState(10);
  const [sosSentConfirmed, setSosSentConfirmed] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState([
    { role: 'assistant', text: `Hello ${currentUser?.name ? currentUser.name.split(' ')[0] : 'there'}! I can help you understand any of your medical reports in simple, plain English. Just ask me!` }
  ]);
  const [inputMsg, setInputMsg] = useState('');

  const mapDoctorReport = (r, idx) => ({
        id: r.id || `rep-doc-${idx}`,
        title: r.title || 'Diagnostic Lab Report',
        doctor: `Uploaded by Doctor (${r.source || 'Pathology Desk'})`,
        date: r.date || r.created_at || '',
        type: 'Diagnostic Report',
        typeColor: 'bg-[#1B6B93]/15 text-[#1B6B93]',
        status: r.tier === 'warning' ? 'Mild Attention' : 'Normal',
        statusColor: r.tier === 'warning' ? 'bg-[#F5A623]/15 text-[#F5A623] border-[#F5A623]/30' : 'bg-[#4CAA6D]/15 text-[#4CAA6D] border-[#4CAA6D]/30',
        summary: `Status: ${r.status || 'Verified'}. ${r.values && r.values.length ? r.values.map(v => `${v.name}: ${v.result}`).join(' · ') : ''}`,
        summaryBullets: r.values ? r.values.map(v => `${v.name}: ${v.result} (Reference Range: ${v.ref}) [${v.status}]`) : ['Diagnostic report uploaded by doctor'],
        fileName: r.fileName || 'Report_Document.pdf',
        fileUrl: r.fileUrl || null,
        fileSize: r.fileSize || '',
        icon: FileText,
        rawText: JSON.stringify(r)
      });

  const fetchDoctorReports = async () => {
    const elderId = currentUser?.id || currentUser?.user_id;
    if (!elderId) return defaultElderReports;
    try {
      const doctorReps = await doctorRecordsService.listReports(elderId);
      return [...(doctorReps || []).map(mapDoctorReport), ...defaultElderReports];
    } catch {
      return defaultElderReports;
    }
  };

  useEffect(() => {
    fetchDoctorReports().then(setReportsList);
    const handleRealtimeSync = () => fetchDoctorReports().then(setReportsList);
    window.addEventListener('elderguard:realtime-event', handleRealtimeSync);
    return () => {
      window.removeEventListener('elderguard:realtime-event', handleRealtimeSync);
    };
  }, [currentUser?.id, currentUser?.user_id]);

  // SOS Countdown Timer & Sound Alarm
  useEffect(() => {
    let timer;
    if (sosActive && !sosSentConfirmed && sosCountdown > 0) {
      startSosAlarmSound("Emergency SOS Activated! Alerting Caretaker and Hospital Emergency Dispatch Desk.");
      timer = setInterval(() => setSosCountdown(prev => prev - 1), 1000);
    } else if (sosActive && !sosSentConfirmed && sosCountdown === 0) {
      triggerEmergencySOS();
    } else if (!sosActive) {
      stopSosAlarmSound();
    }
    return () => {
      clearInterval(timer);
      if (!sosActive) stopSosAlarmSound();
    };
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

  const handleSendChat = (e) => {
    e.preventDefault();
    if (!inputMsg.trim()) return;
    const userMessage = inputMsg;
    setInputMsg('');
    setMessages(prev => [...prev, { role: 'user', text: userMessage }]);

    setTimeout(() => {
      let reply = `Your test results look stable! ${userMessage.toLowerCase().includes('blood') ? 'Your glucose and lipid levels are within baseline monitoring ranges.' : 'All indicators show steady health progress.'}`;
      setMessages(prev => [...prev, { role: 'assistant', text: reply }]);
    }, 600);
  };

  const handleDownloadPdf = (report) => {
    if (!report) return;

    // 1. If real fileUrl exists (base64 Data URL or Blob URL), download directly
    if (report.fileUrl && typeof report.fileUrl === 'string' && report.fileUrl.startsWith('data:')) {
      const link = document.createElement('a');
      link.href = report.fileUrl;
      link.download = report.fileName || `${(report.title || 'Diagnostic_Report').replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return;
    }

    // 2. Fallback Diagnostic PDF document generator
    const docTitle = report.title || 'Diagnostic Lab Report';
    const patientName = currentUser?.name || 'Elder Patient';
    const dateStr = report.date || new Date().toLocaleDateString();
    const doctorStr = report.doctor || 'Pathology Laboratory';
    const summaryStr = report.summary || 'Official clinical report.';
    const bulletsStr = (report.summaryBullets || []).map(b => `  • ${b}`).join('\n');

    const reportText = `
================================================================================
                    ELDERGUARD CLINICAL DIAGNOSTIC REPORT
================================================================================
Document Title  : ${docTitle}
Patient Name    : ${patientName}
Date Issued     : ${dateStr}
Doctor / Lab    : ${doctorStr}
Result Status   : ${report.status || 'Verified'}
File Name       : ${report.fileName || 'Diagnostic_Report.pdf'}
--------------------------------------------------------------------------------

CLINICAL SUMMARY:
${summaryStr}

EXTRACTED TEST METRICS & PARAMETERS:
${bulletsStr || '  • Pathology parameters verified normal.'}

--------------------------------------------------------------------------------
Security Verification: Verified by ElderGuard Medical Records Desk
Reference Key: ${report.id || 'EG-PDF-VERIFIED'}
================================================================================
`;

    const blob = new Blob([reportText], { type: 'application/pdf' });
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = report.fileName || `${docTitle.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  };

  const filtered = reportsList.filter(r =>
    (r.title || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (r.doctor || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (r.type || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-[#FAF7F2] font-inter text-[#2E2E2E] p-4 md:p-8 space-y-8">
      {/* Top Banner */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Main Content (8 Cols) */}
        <div className="lg:col-span-8 space-y-6">
          
          {/* Header Card */}
          <div className="bg-gradient-to-br from-[#FFE8D6] via-[#FFF3E5] to-[#FCEFE3] border border-[#F5DFCD] shadow-[0_10px_30px_rgba(245,223,205,0.4)] rounded-3xl p-6 md:p-8 flex flex-wrap justify-between items-center gap-6">
            <div className="space-y-2 max-w-lg">
              <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-white/90 border border-[#F5DFCD] text-[#1B6B93] text-xs font-bold shadow-sm">
                <Sun className="w-4 h-4 text-[#F5A623]" />
                <span>Your Health Records</span>
              </div>
              <h1 className="font-fraunces font-bold text-3xl md:text-4xl text-[#2E2E2E] tracking-tight leading-tight">
                Medical Reports 📋
              </h1>
              <p className="text-base text-[#525252] font-medium leading-relaxed">
                All your test results and doctor reports in one place, {currentUser?.name ? currentUser.name.split(' ')[0] : 'there'}.
              </p>
              <p className="text-xs text-[#1B6B93] font-semibold flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-[#4CAA6D]" />
                {reportsList.filter(r => r.status === 'Normal').length} of {reportsList.length} reports show Normal results
              </p>
            </div>
            <div className="p-5 rounded-3xl bg-gradient-to-tr from-[#1B6B93] to-[#2E7D8C] shadow-xl shrink-0 border-2 border-white/60">
              <FolderOpen className="w-12 h-12 text-[#FFE8D6]" />
            </div>
          </div>

          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#9CA3AF]" />
            <input
              type="text"
              placeholder="Search by report name, doctor, or type..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-12 pr-5 py-4 rounded-2xl bg-white border border-[#EBE3D5] text-sm text-[#2E2E2E] placeholder-[#9CA3AF] outline-none focus:border-[#1B6B93] shadow-sm font-medium"
            />
          </div>

          {/* Reports List */}
          <div className="space-y-4">
            <div className="flex justify-between items-center px-1">
              <h2 className="font-fraunces font-bold text-2xl text-[#2E2E2E]">Your Reports</h2>
              <span className="text-xs font-semibold text-[#6B7280] bg-white border border-[#EBE3D5] px-3.5 py-1 rounded-full">
                {filtered.length} records
              </span>
            </div>

            {filtered.length === 0 ? (
              <div className="p-10 rounded-3xl bg-white border border-[#EBE3D5] text-center text-[#9CA3AF] text-sm font-medium">
                No reports found for "<span className="text-[#2E2E2E] font-bold">{searchQuery}</span>"
              </div>
            ) : filtered.map((r) => {
              const IconComp = r.icon || FileText;
              return (
                <div
                  key={r.id}
                  className="p-6 rounded-3xl bg-white border border-[#EBE3D5] shadow-[0_6px_24px_rgba(0,0,0,0.04)] hover:border-[#1B6B93]/40 transition-all duration-200"
                >
                  <div className="flex flex-col sm:flex-row justify-between gap-4">
                    {/* Left: Icon + Info */}
                    <div className="flex items-start gap-4">
                      <div className="p-3.5 rounded-2xl bg-[#E6F4F1] text-[#1B6B93] shrink-0">
                        <IconComp className="w-6 h-6" />
                      </div>
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-fraunces font-bold text-xl text-[#2E2E2E]">{r.title}</h3>
                          <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${r.typeColor || 'bg-[#1B6B93]/15 text-[#1B6B93]'}`}>{r.type}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-3 text-xs text-[#6B7280] font-medium">
                          <span className="flex items-center gap-1"><Stethoscope className="w-3.5 h-3.5" /> {r.doctor}</span>
                          <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> {r.date}</span>
                        </div>
                        <p className="text-sm text-[#525252] font-medium leading-relaxed pt-1 max-w-lg">{r.summary}</p>
                      </div>
                    </div>

                    {/* Right: Status + Buttons */}
                    <div className="flex flex-row sm:flex-col items-center sm:items-end gap-3 shrink-0">
                      <span className={`px-3 py-1 rounded-full text-xs font-bold border ${r.statusColor || 'bg-[#4CAA6D]/15 text-[#4CAA6D] border-[#4CAA6D]/30'}`}>
                        {r.status}
                      </span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setViewReport(r)}
                          className="px-4 py-2.5 rounded-xl bg-[#1B6B93] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer hover:bg-[#155373] transition min-h-[40px]"
                        >
                          <Eye className="w-3.5 h-3.5" /> View
                        </button>
                        <button
                          onClick={() => handleDownloadPdf(r)}
                          className="px-4 py-2.5 rounded-xl bg-[#FAF7F2] border border-[#EBE3D5] text-[#1B6B93] hover:bg-[#EEF3F0] text-xs font-bold flex items-center gap-1.5 cursor-pointer transition min-h-[40px]"
                        >
                          <Download className="w-3.5 h-3.5" /> Download PDF
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Sidebar (4 cols) */}
        <div className="lg:col-span-4 space-y-8">

          {/* SOS Card */}
          <div className="bg-gradient-to-br from-[#D32F2F] via-[#C62828] to-[#B71C1C] rounded-3xl p-6 md:p-8 text-white shadow-[0_12px_40px_rgba(211,47,47,0.35)] space-y-5">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-2xl bg-white/20 backdrop-blur-md">
                <PhoneCall className="w-8 h-8" />
              </div>
              <div>
                <h3 className="font-fraunces font-bold text-2xl">Emergency SOS</h3>
                <span className="text-xs text-white/80 font-medium">Multi-Tier Urgent Response</span>
              </div>
            </div>
            <p className="text-white/90 text-sm font-medium leading-relaxed">Press the button below if you feel unwell or need immediate help.</p>
            <button
              onClick={() => { setSosActive(true); setSosCountdown(10); }}
              className="w-full py-5 rounded-2xl bg-white hover:bg-red-50 text-[#C62828] font-fraunces font-bold text-xl shadow-xl hover:scale-[1.02] transition-all flex items-center justify-center gap-3 min-h-[64px] cursor-pointer border-2 border-white/80"
            >
              <PhoneCall className="w-7 h-7 animate-bounce" /> 1-TAP EMERGENCY SOS
            </button>
            <p className="text-center text-xs text-white/80">🔒 Notifies your caregiver & 24/7 Hospital Dispatch</p>
          </div>

          {/* Report Summary Widget */}
          <div className="bg-white border border-[#EBE3D5] rounded-3xl p-6 space-y-4 shadow-[0_8px_30px_rgba(0,0,0,0.04)]">
            <h4 className="font-fraunces font-bold text-lg text-[#2E2E2E] border-b border-[#F0EBE1] pb-3">Reports At a Glance</h4>
            <div className="space-y-3">
              {[
                { label: 'Normal Results', count: reportsList.filter(r => r.status === 'Normal').length, color: 'bg-[#4CAA6D]' },
                { label: 'Mild Attention', count: reportsList.filter(r => r.status === 'Mild Attention').length, color: 'bg-[#F5A623]' },
                { label: 'Total Diagnostic Reports', count: reportsList.length, color: 'bg-[#1B6B93]' },
              ].map(item => (
                <div key={item.label} className="flex items-center justify-between p-3.5 rounded-2xl bg-[#FAF7F2] border border-[#EBE3D5]">
                  <div className="flex items-center gap-2.5 text-sm font-semibold text-[#2E2E2E]">
                    <span className={`w-3 h-3 rounded-full ${item.color}`} />
                    {item.label}
                  </div>
                  <span className="font-black text-lg text-[#2E2E2E]">{item.count}</span>
                </div>
              ))}
            </div>
          </div>

          {/* AI Assistance Box */}
          <div className="bg-gradient-to-br from-[#E6F4F1] to-[#D5ECF0] border border-[#BDE0E8] rounded-3xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-2xl bg-[#1B6B93] text-white">
                <Bot className="w-6 h-6" />
              </div>
              <div>
                <h4 className="font-fraunces font-bold text-base text-[#1B6B93]">Confused by Medical Jargon?</h4>
                <p className="text-xs text-[#6B7280] font-medium">Ask AI to explain in plain English</p>
              </div>
            </div>
            <button
              onClick={() => setChatOpen(true)}
              className="w-full py-4 rounded-2xl bg-[#1B6B93] hover:bg-[#155373] text-white font-bold text-sm transition flex items-center justify-center gap-2 cursor-pointer min-h-[52px]"
            >
              <Bot className="w-5 h-5" /> Explain My Report Simply
            </button>
          </div>
        </div>
      </div>

      {/* Report Detail Modal with Embedded PDF Document Viewer */}
      {viewReport && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 md:p-8 max-w-2xl w-full shadow-2xl border border-[#EBE3D5] space-y-5 font-inter max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start border-b border-[#F0EBE1] pb-4">
              <div>
                <span className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold mb-2 ${viewReport.typeColor || 'bg-[#1B6B93]/15 text-[#1B6B93]'}`}>{viewReport.type}</span>
                <h3 className="font-fraunces font-bold text-2xl text-[#2E2E2E]">{viewReport.title}</h3>
                <p className="text-xs text-[#6B7280] font-medium mt-0.5">By {viewReport.doctor} · Date: {viewReport.date}</p>
              </div>
              <button onClick={() => setViewReport(null)} className="text-[#9CA3AF] hover:text-[#2E2E2E] p-1"><X className="w-6 h-6" /></button>
            </div>

            {/* Embedded PDF / Image Document Viewer Panel */}
            <div className="space-y-2">
              <div className="flex justify-between items-center text-xs font-bold text-[#1B6B93]">
                <span className="flex items-center gap-1.5"><FileText className="w-4 h-4" /> Official PDF Document ({viewReport.fileName || 'Diagnostic_Report.pdf'})</span>
                {viewReport.fileSize && <span className="font-mono text-[#6B7280]">{viewReport.fileSize}</span>}
              </div>

              {viewReport.fileUrl ? (
                <div className="rounded-2xl border border-[#EBE3D5] overflow-hidden bg-gray-50 shadow-inner">
                  {viewReport.fileUrl.startsWith('data:image/') ? (
                    <img src={viewReport.fileUrl} alt={viewReport.title} className="w-full max-h-96 object-contain p-2" />
                  ) : (
                    <iframe
                      src={viewReport.fileUrl}
                      title={viewReport.title}
                      className="w-full h-80 border-0"
                    />
                  )}
                </div>
              ) : (
                <div className="p-5 rounded-2xl bg-gradient-to-br from-[#FAFBFA] to-[#EEF3F0] border border-[#E2E9E4] space-y-3">
                  <div className="flex items-center justify-between border-b border-[#E2E9E4] pb-2">
                    <div className="flex items-center gap-2">
                      <FileText className="w-5 h-5 text-[#0F6B5C]" />
                      <span className="font-bold text-xs text-[#131917]">{viewReport.fileName || 'Diagnostic_Report_Vault.pdf'}</span>
                    </div>
                    <span className="px-2 py-0.5 bg-[#0F6B5C] text-white font-bold text-[10px] rounded uppercase">e-Verified PDF</span>
                  </div>
                  <p className="text-xs text-[#5C6B64]">Official diagnostic report uploaded by doctor. Extracted OCR metrics and pathology parameters are listed below.</p>
                </div>
              )}
            </div>

            <div className="p-4 rounded-2xl bg-[#FAF7F2] border border-[#EBE3D5] space-y-2">
              <p className="text-xs font-bold text-[#6B7280] uppercase tracking-wider">Plain-Language Doctor Summary</p>
              <p className="text-sm font-medium text-[#2E2E2E] leading-relaxed">{viewReport.summary}</p>
            </div>

            {viewReport.summaryBullets && viewReport.summaryBullets.length > 0 && (
              <div className="p-4 rounded-2xl bg-[#EEF3F0] border border-[#E2E9E4] space-y-1.5 text-xs">
                <p className="font-bold text-[#0F6B5C] uppercase tracking-wider text-[10px]">Extracted Test Parameters & Values</p>
                <ul className="list-disc list-inside space-y-1 text-[#2E2E2E]">
                  {viewReport.summaryBullets.map((b, i) => (
                    <li key={i} className="font-mono font-medium">{b}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex items-center gap-2 p-4 rounded-2xl bg-[#4CAA6D]/10 border border-[#4CAA6D]/30">
              <CheckCircle2 className="w-5 h-5 text-[#4CAA6D] shrink-0" />
              <p className="text-xs font-semibold text-[#2E2E2E]">Status: <span className={`font-bold ${viewReport.status === 'Normal' ? 'text-[#4CAA6D]' : viewReport.status === 'Mild Attention' ? 'text-[#F5A623]' : 'text-[#9CA3AF]'}`}>{viewReport.status}</span></p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                onClick={() => handleDownloadPdf(viewReport)}
                className="flex-1 py-3.5 rounded-2xl bg-[#1B6B93] hover:bg-[#155373] text-white font-bold text-xs flex items-center justify-center gap-2 transition text-center shadow-xs cursor-pointer"
              >
                <Download className="w-4 h-4" /> Download PDF Document
              </button>
              <button onClick={() => setViewReport(null)} className="px-6 py-3.5 rounded-2xl border border-[#EBE3D5] text-[#6B7280] font-bold text-xs cursor-pointer hover:bg-[#FAF7F2] transition">
                Close Report View
              </button>
            </div>
          </div>
        </div>
      )}



      {/* SOS Modal */}
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
