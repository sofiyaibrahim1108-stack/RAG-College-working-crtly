import React, { useState, useEffect, useRef } from 'react';
import {
  fetchHealth,
  fetchDepartments,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  fetchDocuments,
  uploadDocuments,
  deleteDocumentRecord,
  sendChatMessageStream,
  fetchChatHistory,
  fetchConversations,
  deleteConversationRecord,
  truncateChatHistory,
  importDriveFile,
  loginUser,
  registerUser,
  fetchCurrentUser,
  logoutUser,
  setAuthToken,
  removeAuthToken,
  fetchUsers,
  createUserRecord,
  toggleUserStatusRecord,
  deleteUserRecord,
  updateProfile
} from './api';
import { Pencil, AlertCircle, RotateCcw, Loader2 } from 'lucide-react';
import { getFriendlyErrorMessage } from './utils/errorHandler';

import Sidebar from './components/Sidebar';
import ChatHeader from './components/ChatHeader';
import ChatHome from './components/ChatHome';
import MessageItem from './components/MessageItem';
import ChatComposer from './components/ChatComposer';
import DocumentsView from './components/DocumentsView';
import DepartmentsView from './components/DepartmentsView';
import UsersView from './components/UsersView';
import AuditLogsView from './components/AuditLogsView';
import UploadModal from './components/UploadModal';
import DepartmentModal from './components/DepartmentModal';
import ConfirmModal from './components/ConfirmModal';
import SettingsModal from './components/SettingsModal';
import GoogleDriveModal from './components/GoogleDriveModal';
import AuthModal from './components/AuthModal';
import Toast from './components/Toast';
import HorizontalStepper from './components/HorizontalStepper';

const DEFAULT_PROGRESS_STEPS = [
  { id: 'router', shortTitle: 'Understanding', title: 'Understanding your question', status: 'pending', detail: 'Understanding your question...' },
  { id: 'retrieval', shortTitle: 'Searching', title: 'Searching relevant information', status: 'pending', detail: 'Searching relevant information...' },
  { id: 'rerank', shortTitle: 'Checking', title: 'Checking relevant sources', status: 'pending', detail: 'Checking relevant sources...' },
  { id: 'llm', shortTitle: 'Preparing', title: 'Preparing your answer', status: 'pending', detail: 'Preparing your answer...' }
];

const PENDING_QUERY_KEY_PREFIX = 'pending_rag_query_';
const STREAM_FLUSH_MS = 40;

function createStreamWriter(applyText) {
  let text = '';
  let timer = null;

  const flush = () => {
    timer = null;
    applyText(text);
  };

  return {
    push(chunk) {
      text += chunk;
      if (!timer) timer = setTimeout(flush, STREAM_FLUSH_MS);
    },
    reset() {
      text = '';
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      applyText('');
    },
    cancel() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    }
  };
}

function getPendingQuery(sessionId) {
  if (!sessionId) return null;
  try {
    const raw = localStorage.getItem(`${PENDING_QUERY_KEY_PREFIX}${sessionId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.question !== 'string' || !parsed.question.trim()) return null;
    if (typeof parsed.timestamp !== 'number' || isNaN(parsed.timestamp)) return null;
    return {
      question: parsed.question.trim(),
      timestamp: parsed.timestamp
    };
  } catch (err) {
    console.warn('Error reading pending query from localStorage:', err);
    return null;
  }
}

function setPendingQuery(sessionId, question) {
  if (!sessionId || !question) return;
  try {
    const entry = { question: question.trim(), timestamp: Date.now() };
    localStorage.setItem(`${PENDING_QUERY_KEY_PREFIX}${sessionId}`, JSON.stringify(entry));
  } catch (err) {
    console.warn('Error writing pending query to localStorage:', err);
  }
}

function clearPendingQuery(sessionId) {
  if (!sessionId) return;
  try {
    localStorage.removeItem(`${PENDING_QUERY_KEY_PREFIX}${sessionId}`);
  } catch (err) {
    console.warn('Error removing pending query from localStorage:', err);
  }
}

function hasAssistantResponseForPending(dbMsgs, pendingQuestion) {
  if (!Array.isArray(dbMsgs) || dbMsgs.length === 0) return false;
  let lastUserIndex = -1;
  for (let i = dbMsgs.length - 1; i >= 0; i--) {
    if (dbMsgs[i].role === 'user') {
      lastUserIndex = i;
      break;
    }
  }
  if (lastUserIndex === -1) return false;

  const hasAssistantAfterLastUser = dbMsgs.slice(lastUserIndex + 1).some((m) => m.role === 'assistant');

  if (!pendingQuestion) return hasAssistantAfterLastUser;

  const lastUserMsg = dbMsgs[lastUserIndex];
  const questionMatches = (lastUserMsg.content || '').trim() === pendingQuestion.trim();

  return hasAssistantAfterLastUser && questionMatches;
}

function formatDbMessage(m) {
  return {
    id: m._id,
    role: m.role,
    content: m.content,
    sources: m.sources || [],
    intent: m.metadata?.intent || m.detectedIntent || null,
    timings: m.metadata?.timings || m.timings || null,
    suggestedQuestions: m.metadata?.suggestedQuestions || m.suggestedQuestions || [],
    createdAt: m.createdAt
  };
}

export default function App() {
  const getInitialView = () => {
    try {
      const params = new URLSearchParams(window.location.search);
      const viewParam = params.get('view');
      if (['documents', 'departments', 'chat', 'users', 'audit-logs'].includes(viewParam)) {
        return viewParam;
      }
    } catch {
      // fallback
    }
    return 'chat';
  };

  const [activeView, setActiveViewState] = useState(getInitialView);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [searchConvQuery, setSearchConvQuery] = useState('');

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem('rag_sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const toggleSidebarCollapse = () => {
    setIsSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('rag_sidebar_collapsed', String(next));
      } catch (e) {
        console.warn('Could not save sidebar collapsed preference', e);
      }
      return next;
    });
  };

  const handleToggleSidebar = () => {
    if (window.innerWidth <= 768) {
      setIsMobileSidebarOpen((prev) => !prev);
    } else {
      toggleSidebarCollapse();
    }
  };

  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem('rag_college_theme') || localStorage.getItem('theme');
      if (saved === 'dark' || saved === 'light') {
        return saved;
      }
    } catch {
      // fallback
    }
    return 'dark';
  });

  useEffect(() => {
    try {
      localStorage.setItem('rag_college_theme', theme);
      localStorage.setItem('theme', theme);
    } catch (e) {
      console.warn('Could not save theme to localStorage', e);
    }
    document.documentElement.setAttribute('data-theme', theme);
    document.body.setAttribute('data-theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  const setActiveView = (view) => {
    setActiveViewState(view);
    try {
      const url = new URL(window.location.href);
      if (view === 'chat') {
        url.searchParams.delete('view');
      } else {
        url.searchParams.set('view', view);
      }
      window.history.pushState({}, '', url.pathname + url.search);
    } catch (e) {
      console.warn('Could not update history state', e);
    }
  };

  useEffect(() => {
    const handlePopState = () => {
      setActiveViewState(getInitialView());
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Core Data State
  const [health, setHealth] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [usersList, setUsersList] = useState([]);
  const [isDocsLoading, setIsDocsLoading] = useState(false);
  const [isDeptsLoading, setIsDeptsLoading] = useState(false);
  const [isUsersLoading, setIsUsersLoading] = useState(false);
  const [isAnswerStreaming, setIsAnswerStreaming] = useState(false);

  // Auth & Session
  const [currentUser, setCurrentUser] = useState(null);
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [showAuthModal, setShowAuthModal] = useState(false);

  // Active Chat State
  const [activeConvId, setActiveConvId] = useState('session-default');
  const [messages, setMessages] = useState([]);
  const [inputQuery, setInputQuery] = useState('');
  const [editingMessage, setEditingMessage] = useState(null);
  const [isSending, setIsSending] = useState(false);
  const [regeneratingId, setRegeneratingId] = useState(null);

  const [selectedDepartmentId, setSelectedDepartmentId] = useState(null);
  const selectedDepartmentIdRef = useRef(null);

  const handleSelectDepartment = (deptId) => {
    setSelectedDepartmentId(deptId);
    selectedDepartmentIdRef.current = deptId;
  };

  const [answerLength, setAnswerLength] = useState('Auto');
  const answerLengthRef = useRef(answerLength);

  useEffect(() => {
    answerLengthRef.current = answerLength;
  }, [answerLength]);

  const [visualMode, setVisualMode] = useState(null);
  const visualModeRef = useRef(null);

  useEffect(() => {
    visualModeRef.current = visualMode;
  }, [visualMode]);

  useEffect(() => {
    try {
      localStorage.removeItem('rag_visual_mode');
    } catch {
      // ignore
    }
  }, []);

  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [unresolvedStatus, setUnresolvedStatus] = useState(null);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [showRetryConfirm, setShowRetryConfirm] = useState(false);
  const activeConvIdRef = useRef(activeConvId);
  const pollingTimerRef = useRef(null);
  const isPollingRef = useRef(false);

  useEffect(() => {
    activeConvIdRef.current = activeConvId;
    if (currentUser) {
      const uId = currentUser._id || currentUser.id || 'default';
      try {
        localStorage.setItem(`rag_last_active_conv_${uId}`, activeConvId);
      } catch {
        // ignore
      }
    }
  }, [activeConvId, currentUser]);

  const [progressSteps, setProgressSteps] = useState(DEFAULT_PROGRESS_STEPS);

  const [pinnedIds, setPinnedIds] = useState(() => {
    try {
      const saved = localStorage.getItem('rag_pinned_convs');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const handleTogglePinConversation = (convId) => {
    setPinnedIds((prev) => {
      const isPinned = prev.includes(convId);
      const next = isPinned ? prev.filter((id) => id !== convId) : [convId, ...prev];
      try {
        localStorage.setItem('rag_pinned_convs', JSON.stringify(next));
      } catch (e) {
        console.warn('Could not save pinned conversations', e);
      }
      addToast(isPinned ? 'Conversation unpinned' : 'Conversation pinned', 'info');
      return next;
    });
  };

  // Modals & Notifications
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [reuploadDoc, setReuploadDoc] = useState(null);
  const [showDriveModal, setShowDriveModal] = useState(false);
  const [showDeptModal, setShowDeptModal] = useState(false);
  const [editingDept, setEditingDept] = useState(null);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settingsTab, setSettingsTab] = useState('appearance');

  const [confirmDelete, setConfirmDelete] = useState({
    isOpen: false,
    type: null,
    item: null,
    title: '',
    name: '',
    warning: '',
    onConfirmAction: null
  });

  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    let isMounted = true;
    async function restoreSession() {
      try {
        const user = await fetchCurrentUser();
        if (isMounted && user) {
          setCurrentUser(user);
        }
      } catch (err) {
        console.warn('Session restoration failed:', err);
      } finally {
        if (isMounted) {
          setIsAuthChecking(false);
        }
      }
    }
    restoreSession();
    return () => {
      isMounted = false;
    };
  }, []);

  // RBAC Guard
  useEffect(() => {
    if (currentUser && currentUser.role !== 'admin' && activeView !== 'chat') {
      setActiveView('chat');
    }
  }, [currentUser, activeView]);

  const handleLogin = async (credentials) => {
    setConversations([]);
    setMessages([]);
    const data = await loginUser(credentials);

    if (data.token) {
      setAuthToken(data.token);
    }

    const activeUser = data.user;
    setCurrentUser(activeUser);

    const uId = activeUser?._id || activeUser?.id || 'default';
    const freshSessionId = `session-${Date.now()}`;
    setActiveConvId(freshSessionId);
    try {
      localStorage.setItem(`rag_last_active_conv_${uId}`, freshSessionId);
    } catch (e) {
      // ignore
    }

    setActiveView('chat');
    addToast(`Signed in as ${activeUser?.name || 'User'}`, 'success');
  };

  const handleRegister = async (payload) => {
    const data = await registerUser(payload);
    removeAuthToken();
    addToast('Account created successfully. Please sign in.', 'success');
    return data;
  };

  const handleLogout = () => {
    if (currentUser) {
      const uId = currentUser._id || currentUser.id || 'default';
      try {
        localStorage.removeItem(`rag_last_active_conv_${uId}`);
      } catch (e) {
        // ignore
      }
    }
    logoutUser();
    setCurrentUser(null);
    setConversations([]);
    setMessages([]);
    setUsersList([]);
    setActiveConvId(`session-${Date.now()}`);
    addToast('Signed out successfully', 'info');
  };

  // Profile Update Handler
  const handleUpdateProfile = async (payload) => {
    const res = await updateProfile(payload);
    if (res.user) {
      setCurrentUser((prev) => ({ ...prev, ...res.user }));
      addToast('Profile updated successfully', 'success');
    }
    return res;
  };

  const handleOpenSettingsModal = (tab = 'appearance') => {
    setSettingsTab(tab);
    setShowSettingsModal(true);
  };

  // User Management Handlers (Admin Only)
  const loadUsersData = async () => {
    if (currentUser?.role !== 'admin') return;
    try {
      setIsUsersLoading(true);
      const res = await fetchUsers();
      setUsersList(res.data || []);
    } catch (err) {
      console.error('Error fetching users:', err);
      addToast(getFriendlyErrorMessage(err, 'user-load') || 'Failed to load users list', 'error');
    } finally {
      setIsUsersLoading(false);
    }
  };

  useEffect(() => {
    if (currentUser?.role === 'admin' && activeView === 'users') {
      loadUsersData();
    }
  }, [currentUser, activeView]);

  const handleCreateUser = async (formData) => {
    try {
      await createUserRecord(formData);
      addToast('User account created successfully', 'success');
      loadUsersData();
    } catch (err) {
      console.error('Create user error:', err);
      addToast(err.response?.data?.message || err.message || 'Failed to create user', 'error');
      throw err;
    }
  };

  const handleToggleUserStatus = async (id, status) => {
    try {
      await toggleUserStatusRecord(id, status);
      addToast(`User marked as ${status}`, 'success');
      loadUsersData();
    } catch (err) {
      console.error('Toggle status error:', err);
      addToast(err.response?.data?.message || err.message || 'Failed to update user status', 'error');
    }
  };

  const handleTriggerDeleteUser = (targetUser) => {
    if (!currentUser || currentUser.role !== 'admin') {
      addToast('Admin privileges required to delete users.', 'error');
      return;
    }
    setConfirmDelete({
      isOpen: true,
      type: 'user',
      item: targetUser,
      title: 'Delete User Account?',
      name: `${targetUser.name} (${targetUser.email})`,
      warning: 'This will completely remove this account and revoke their application access.'
    });
  };

  const handleOpenUpload = () => {
    if (!currentUser) {
      setShowAuthModal(true);
      return;
    }
    if (currentUser.role !== 'admin') {
      addToast('Admin privileges required to upload documents.', 'error');
      return;
    }
    setReuploadDoc(null);
    setShowUploadModal(true);
  };

  const handleOpenDrive = () => {
    if (!currentUser) {
      setShowAuthModal(true);
      return;
    }
    if (currentUser.role !== 'admin') {
      addToast('Admin privileges required to manage Google Drive.', 'error');
      return;
    }
    setShowDriveModal(true);
  };

  const handleOpenCreateDept = () => {
    if (!currentUser) {
      setShowAuthModal(true);
      return;
    }
    if (currentUser.role !== 'admin') {
      addToast('Admin privileges required to manage departments.', 'error');
      return;
    }
    setEditingDept(null);
    setShowDeptModal(true);
  };

  const addToast = (text, type = 'success') => {
    const id = Date.now() + Math.random().toString(36).substring(2, 6);
    setToasts((prev) => [...prev, { id, text, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  const removeToast = (id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const isNearBottomRef = useRef(true);
  const isSendingRef = useRef(false);
  const activeRequestIdRef = useRef(0);
  const abortControllerRef = useRef(null);

  const handleMessagesScroll = (e) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);
    isNearBottomRef.current = distanceFromBottom <= 120;
  };

  const scrollToBottom = (behavior = 'smooth', force = false) => {
    if (force || isNearBottomRef.current) {
      if (messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({ behavior, block: 'end' });
      } else if (messagesContainerRef.current) {
        messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
      }
    }
  };

  useEffect(() => {
    if (activeView === 'chat' && messages.length > 0) {
      const isStreamingNow = messages.some((m) => m.isStreaming);
      scrollToBottom(isStreamingNow ? 'auto' : 'smooth');
    }
  }, [messages, isSending, activeView]);

  useEffect(() => {
    isNearBottomRef.current = true;
  }, [activeConvId, activeView]);

  const loadInitialData = async () => {
    try {
      const [healthData, deptsData, docsData, convsData] = await Promise.all([
        fetchHealth().catch(() => null),
        fetchDepartments().catch(() => ({ data: [] })),
        fetchDocuments().catch(() => ({ data: [] })),
        fetchConversations().catch(() => ({ data: [] }))
      ]);

      setHealth(healthData);
      setDepartments(deptsData.data || []);
      setDocuments(docsData.data || []);

      const uId = currentUser?._id || currentUser?.id || 'default';
      const savedActive = localStorage.getItem(`rag_last_active_conv_${uId}`);

      if (convsData.data && convsData.data.length > 0) {
        const loadedConvs = convsData.data.map((c) => ({
          id: c.sessionId,
          title: c.title || 'Untitled Conversation',
          updatedAt: c.updatedAt || c.createdAt
        }));

        setConversations(loadedConvs);
        if (savedActive && loadedConvs.some((c) => c.id === savedActive)) {
          setActiveConvId(savedActive);
        } else {
          setActiveConvId(convsData.data[0].sessionId);
        }
      } else {
        setConversations([]);
        setActiveConvId(savedActive || `session-${Date.now()}`);
      }
    } catch (err) {
      console.error('Error loading initial data:', err);
      addToast('Failed to load system data', 'error');
    }
  };

  useEffect(() => {
    if (currentUser) {
      loadInitialData();
    }
  }, [currentUser]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('driveAuth') === 'success') {
      addToast('Google Drive connected successfully!', 'success');
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete('driveAuth');
      window.history.replaceState({}, document.title, cleanUrl.pathname + cleanUrl.search);
    } else if (params.get('driveAuth') === 'error') {
      const msg = params.get('message') || 'Authentication failed';
      addToast(`Google Drive connection notice: ${msg}`, 'error');
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete('driveAuth');
      cleanUrl.searchParams.delete('message');
      window.history.replaceState({}, document.title, cleanUrl.pathname + cleanUrl.search);
    }
  }, []);

  const docsProcessingRef = useRef(false);
  docsProcessingRef.current = documents.some((d) => {
    const s = String(d.status || d.processingStatus || '').toLowerCase();
    return s === 'processing' || s === 'pending';
  });

  useEffect(() => {
    if (!currentUser || currentUser.role !== 'admin') return;

    const intervalId = setInterval(async () => {
      if (!docsProcessingRef.current) return;

      try {
        const docsData = await fetchDocuments();
        if (docsData && docsData.data) {
          setDocuments(docsData.data);
        }
      } catch (err) {
        // Silently catch background fetch errors
      }
    }, 5000);

    return () => clearInterval(intervalId);
  }, [currentUser]);

  const stopRecoveryPolling = () => {
    if (pollingTimerRef.current) {
      clearInterval(pollingTimerRef.current);
      pollingTimerRef.current = null;
    }
    isPollingRef.current = false;
  };

  const startRecoveryPolling = (sessionId, pendingQuestion) => {
    stopRecoveryPolling();

    const pollStartTime = Date.now();
    const MAX_POLLING_DURATION_MS = 120000;

    pollingTimerRef.current = setInterval(async () => {
      if (activeConvIdRef.current !== sessionId) {
        stopRecoveryPolling();
        return;
      }

      if (isPollingRef.current) return;

      if (Date.now() - pollStartTime >= MAX_POLLING_DURATION_MS) {
        stopRecoveryPolling();
        setIsSending(false);
        isSendingRef.current = false;
        setIsAnswerStreaming(false);
        setUnresolvedStatus({
          type: 'unknown',
          question: pendingQuestion,
          sessionId
        });
        return;
      }

      isPollingRef.current = true;
      try {
        const hist = await fetchChatHistory(sessionId);
        if (activeConvIdRef.current !== sessionId) return;

        const dbMsgs = (hist.data || []).map(formatDbMessage);
        const assistantFound = hasAssistantResponseForPending(dbMsgs, pendingQuestion);

        if (assistantFound) {
          stopRecoveryPolling();
          clearPendingQuery(sessionId);
          setMessages(dbMsgs);
          setIsSending(false);
          isSendingRef.current = false;
          setIsAnswerStreaming(false);
          setUnresolvedStatus(null);
          setShowRetryConfirm(false);
        } else {
          if (dbMsgs.length > 0) {
            setMessages(dbMsgs);
          }
        }
      } catch (err) {
        console.warn('Recovery polling transient error:', err);
      } finally {
        isPollingRef.current = false;
      }
    }, 2500);
  };

  const handleCheckStatus = async () => {
    if (isCheckingStatus) return;
    setIsCheckingStatus(true);
    try {
      const hist = await fetchChatHistory(activeConvId);
      if (activeConvIdRef.current !== activeConvId) return;

      const dbMsgs = (hist.data || []).map(formatDbMessage);
      const assistantFound = hasAssistantResponseForPending(dbMsgs, unresolvedStatus?.question);

      if (assistantFound) {
        setMessages(dbMsgs);
        clearPendingQuery(activeConvId);
        setUnresolvedStatus(null);
        setShowRetryConfirm(false);
        addToast('Answer found and loaded!', 'success');
      } else {
        addToast('No answer recorded yet. The question may still be processing.', 'info');
      }
    } catch (err) {
      console.error('Manual status check error:', err);
      addToast('Could not check status right now. Please try again.', 'error');
    } finally {
      setIsCheckingStatus(false);
    }
  };

  const handleRetryOrphaned = async (userMsg) => {
    if (isSending || isSendingRef.current) return;
    const questionToRetry = userMsg?.content || unresolvedStatus?.question;
    if (!questionToRetry) return;

    setUnresolvedStatus(null);
    setShowRetryConfirm(false);

    if (userMsg?.id && !String(userMsg.id).startsWith('pending-') && !String(userMsg.id).startsWith('user-')) {
      try {
        await truncateChatHistory(activeConvId, userMsg.id);
      } catch (truncErr) {
        console.warn('Failed to truncate orphaned message on server:', truncErr);
      }
    }

    setMessages((prev) => {
      if (!userMsg?.id) return prev;
      const idx = prev.findIndex((m) => m.id === userMsg.id);
      return idx !== -1 ? prev.slice(0, idx) : prev;
    });

    await handleSendMessage(questionToRetry, null);
  };

  useEffect(() => {
    setEditingMessage(null);
    setUnresolvedStatus(null);
    setShowRetryConfirm(false);
    stopRecoveryPolling();
    setVisualMode(null);
    visualModeRef.current = null;

    if (!currentUser || !activeConvId) return;

    let isCurrentSession = true;
    const currentSessionId = activeConvId;

    async function loadHistoryAndRestorePending() {
      setIsHistoryLoading(true);
      const pending = getPendingQuery(currentSessionId);
      const isStale = pending && (Date.now() - pending.timestamp > 10 * 60 * 1000);

      if (isStale) {
        clearPendingQuery(currentSessionId);
      }

      const hasValidPending = pending && !isStale;

      if (hasValidPending) {
        setIsSending(true);
        isSendingRef.current = true;
        setProgressSteps([
          { id: 'router', shortTitle: 'Understanding', title: 'Understanding your question', status: 'done', detail: 'Question analyzed' },
          { id: 'retrieval', shortTitle: 'Searching', title: 'Searching relevant information', status: 'done', detail: 'Information retrieved' },
          { id: 'rerank', shortTitle: 'Checking', title: 'Checking relevant sources', status: 'active', detail: 'Evaluating candidate sources...' },
          { id: 'llm', shortTitle: 'Preparing', title: 'Preparing your answer', status: 'pending', detail: 'Synthesizing response...' }
        ]);

        const placeholderUserMsg = {
          id: `pending-${pending.timestamp}`,
          role: 'user',
          content: pending.question,
          createdAt: new Date(pending.timestamp).toISOString()
        };
        setMessages([placeholderUserMsg]);
      } else {
        if (!isSendingRef.current) {
          setIsSending(false);
        }
      }

      try {
        const hist = await fetchChatHistory(currentSessionId);
        if (!isCurrentSession || activeConvIdRef.current !== currentSessionId) return;

        const dbMsgs = (hist.data || []).map(formatDbMessage);

        if (hasValidPending) {
          const assistantFound = hasAssistantResponseForPending(dbMsgs, pending.question);

          if (assistantFound) {
            setMessages(dbMsgs);
            clearPendingQuery(currentSessionId);
            setIsSending(false);
            isSendingRef.current = false;
            setIsAnswerStreaming(false);
            setUnresolvedStatus(null);
          } else {
            const userMsgInDb = dbMsgs.find(
              (m) => m.role === 'user' && m.content.trim() === pending.question.trim()
            );

            if (userMsgInDb) {
              setMessages(dbMsgs);
            } else {
              setMessages([
                ...dbMsgs,
                {
                  id: `pending-${pending.timestamp}`,
                  role: 'user',
                  content: pending.question,
                  createdAt: new Date(pending.timestamp).toISOString()
                }
              ]);
            }

            setIsSending(true);
            isSendingRef.current = true;
            startRecoveryPolling(currentSessionId, pending.question);
          }
        } else {
          setMessages(dbMsgs);

          const lastDbMsg = dbMsgs.length > 0 ? dbMsgs[dbMsgs.length - 1] : null;
          const msgAgeMs = lastDbMsg?.createdAt ? Date.now() - new Date(lastDbMsg.createdAt).getTime() : Infinity;
          const isRecentInFlightUser = lastDbMsg?.role === 'user' && msgAgeMs < 90000;

          if (isRecentInFlightUser) {
            setIsSending(true);
            isSendingRef.current = true;
            setProgressSteps([
              { id: 'router', shortTitle: 'Understanding', title: 'Understanding your question', status: 'done', detail: 'Question analyzed' },
              { id: 'retrieval', shortTitle: 'Searching', title: 'Searching relevant information', status: 'done', detail: 'Information retrieved' },
              { id: 'rerank', shortTitle: 'Checking', title: 'Checking relevant sources', status: 'active', detail: 'Evaluating candidate sources...' },
              { id: 'llm', shortTitle: 'Preparing', title: 'Preparing your answer', status: 'pending', detail: 'Synthesizing response...' }
            ]);
            setPendingQuery(currentSessionId, lastDbMsg.content);
            startRecoveryPolling(currentSessionId, lastDbMsg.content);
          } else if (!isSendingRef.current) {
            setIsSending(false);
          }
        }
      } catch (err) {
        console.error('Error loading chat history:', err);
        if (isCurrentSession && !isSendingRef.current) {
          setMessages([]);
        }
      } finally {
        if (isCurrentSession) {
          setIsHistoryLoading(false);
        }
      }
    }

    loadHistoryAndRestorePending();

    return () => {
      isCurrentSession = false;
      stopRecoveryPolling();
    };
  }, [activeConvId, currentUser]);

  const handleNewChat = () => {
    activeRequestIdRef.current++;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    stopRecoveryPolling();
    isSendingRef.current = false;
    setIsSending(false);
    setIsAnswerStreaming(false);
    setEditingMessage(null);
    setInputQuery('');
    setUnresolvedStatus(null);
    setShowRetryConfirm(false);
    setAnswerLength('Auto');
    setVisualMode(null);
    visualModeRef.current = null;

    const newSessionId = `session-${Date.now()}`;
    setActiveConvId(newSessionId);
    setMessages([]);
    setActiveView('chat');
  };

  const handleStartEditMessage = (msg) => {
    setEditingMessage({
      id: msg.id,
      content: msg.content,
      sessionId: activeConvId
    });
    setInputQuery(msg.content);
  };

  const handleCancelEdit = () => {
    setEditingMessage(null);
    setInputQuery('');
  };

  const handleRenameConversation = (convId, newTitle) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === convId ? { ...c, title: newTitle } : c))
    );
    addToast('Conversation renamed', 'success');
  };

  const handleDeleteConversation = (convId) => {
    const target = conversations.find((c) => c.id === convId);
    setConfirmDelete({
      isOpen: true,
      type: 'conversation',
      item: { id: convId },
      title: 'Delete this conversation?',
      name: target ? target.title : 'this conversation',
      warning: 'This conversation will be permanently removed.'
    });
  };

  const handleStopGeneration = () => {
    activeRequestIdRef.current++;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    clearPendingQuery(activeConvId);
    stopRecoveryPolling();
    isSendingRef.current = false;
    setIsSending(false);
    setIsAnswerStreaming(false);
    setRegeneratingId(null);
    setUnresolvedStatus(null);
    setShowRetryConfirm(false);
    setMessages((prev) => prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m)));
  };

  const handleSendMessage = async (textToSend, explicitVisualMode) => {
    if (isSendingRef.current) return;

    const query = (textToSend || inputQuery).trim();
    if (!query || isSending) return;

    const messageVisualMode = explicitVisualMode !== undefined
      ? explicitVisualMode
      : (textToSend ? null : visualModeRef.current);

    setVisualMode(null);
    visualModeRef.current = null;

    const requestSessionId = activeConvId;
    const isEditMode = !!editingMessage;
    const editTarget = editingMessage;
    setEditingMessage(null);
    setUnresolvedStatus(null);
    setShowRetryConfirm(false);

    isSendingRef.current = true;
    const currentRequestId = ++activeRequestIdRef.current;
    const isCurrentRequest = () =>
      activeRequestIdRef.current === currentRequestId && activeConvIdRef.current === requestSessionId;

    setProgressSteps([
      { id: 'router', shortTitle: 'Understanding', title: 'Understanding your question', status: 'active', detail: 'Understanding your question...' },
      { id: 'retrieval', shortTitle: 'Searching', title: 'Searching relevant information', status: 'pending', detail: 'Awaiting question analysis...' },
      { id: 'rerank', shortTitle: 'Checking', title: 'Checking relevant sources', status: 'pending', detail: 'Evaluating candidate sources...' },
      { id: 'llm', shortTitle: 'Preparing', title: 'Preparing your answer', status: 'pending', detail: 'Synthesizing response...' }
    ]);

    const timer1 = setTimeout(() => {
      if (isSendingRef.current && isCurrentRequest()) {
        setProgressSteps((prev) => [
          { ...prev[0], status: 'done', detail: 'Question understood' },
          { ...prev[1], status: 'active', detail: 'Searching relevant information...' },
          prev[2],
          prev[3]
        ]);
      }
    }, 700);

    const timer2 = setTimeout(() => {
      if (isSendingRef.current && isCurrentRequest()) {
        setProgressSteps((prev) => [
          prev[0],
          { ...prev[1], status: 'done', detail: 'Information found' },
          { ...prev[2], status: 'active', detail: 'Checking relevant sources...' },
          prev[3]
        ]);
      }
    }, 1500);

    const timer3 = setTimeout(() => {
      if (isSendingRef.current && isCurrentRequest()) {
        setProgressSteps((prev) => [
          prev[0],
          prev[1],
          { ...prev[2], status: 'done', detail: 'Sources checked' },
          { ...prev[3], status: 'active', detail: 'Preparing your answer...' }
        ]);
      }
    }, 2400);

    const clearStepperTimers = () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
    };

    if (isEditMode && editTarget) {
      try {
        await truncateChatHistory(editTarget.sessionId || requestSessionId, editTarget.id);
      } catch (truncErr) {
        console.warn('Failed to truncate history on server:', truncErr);
      }
    }

    const userMsgId = `user-${Date.now()}`;
    const userMsg = {
      id: userMsgId,
      role: 'user',
      content: query,
      createdAt: new Date().toISOString()
    };

    if (isEditMode && editTarget) {
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === editTarget.id);
        const retained = idx !== -1 ? prev.slice(0, idx) : prev;
        return [...retained, userMsg];
      });
    } else {
      setMessages((prev) => [...prev, userMsg]);
    }

    setInputQuery('');
    setIsSending(true);
    isNearBottomRef.current = true;
    setTimeout(() => scrollToBottom('smooth', true), 50);

    setPendingQuery(requestSessionId, query);

    setConversations((prev) => {
      const titleSnippet = query.length > 36 ? query.substring(0, 36) + '...' : query;
      if (!prev.some((c) => c.id === requestSessionId)) {
        return [{ id: requestSessionId, title: titleSnippet, updatedAt: new Date().toISOString() }, ...prev];
      }
      return prev.map((c) => {
        if (c.id === requestSessionId && (c.title === 'New Conversation' || !c.title)) {
          return { ...c, title: titleSnippet, updatedAt: new Date().toISOString() };
        }
        return c;
      });
    });

    const streamMsgId = `stream-${Date.now()}`;
    let firstTokenSeen = false;

    const writer = createStreamWriter((text) => {
      if (!isCurrentRequest()) return;
      setMessages((prev) => {
        const exists = prev.some((m) => m.id === streamMsgId);
        if (!text) {
          return exists ? prev.filter((m) => m.id !== streamMsgId) : prev;
        }
        if (exists) {
          return prev.map((m) => (m.id === streamMsgId ? { ...m, content: text } : m));
        }
        return [
          ...prev,
          {
            id: streamMsgId,
            role: 'assistant',
            content: text,
            sources: [],
            isStreaming: true,
            createdAt: new Date().toISOString()
          }
        ];
      });
    });

    try {
      const activeDept = selectedDepartmentIdRef.current || selectedDepartmentId;
      const departmentIds = activeDept ? [String(activeDept)] : [];

      const controller = new AbortController();
      abortControllerRef.current = controller;

      const res = await sendChatMessageStream({
        message: query,
        sessionId: requestSessionId,
        departmentIds,
        selectedDepartments: departmentIds,
        answerLength: answerLengthRef.current,
        visualMode: messageVisualMode,
        signal: controller.signal,
        onToken: (chunk) => {
          if (!isCurrentRequest()) return;
          if (!firstTokenSeen) {
            firstTokenSeen = true;
            setIsAnswerStreaming(true);
            clearStepperTimers();
          }
          writer.push(chunk);
        },
        onReset: () => {
          if (isCurrentRequest()) writer.reset();
        }
      });

      writer.cancel();
      clearPendingQuery(requestSessionId);

      if (activeRequestIdRef.current !== currentRequestId) return;

      const returnedSessionId = res.sessionId || res.data?.sessionId;
      if (returnedSessionId && returnedSessionId !== requestSessionId) {
        setActiveConvId(returnedSessionId);
      }

      clearStepperTimers();

      setProgressSteps((prev) =>
        prev.map((step) => ({
          ...step,
          status: 'done'
        }))
      );

      if (res.userMessageId) {
        setMessages((prev) =>
          prev.map((m) => (m.id === userMsgId ? { ...m, id: res.userMessageId } : m))
        );
      }

      const assistantMsg = {
        id: res.assistantMessageId || `assistant-${Date.now()}`,
        role: 'assistant',
        content: res.data?.answer || res.answer || "I couldn't find relevant information in your connected documents.",
        sources: res.data?.sources || res.sources || [],
        intent: res.data?.intent || res.intent,
        timings: res.data?.timings || res.timings,
        suggestedQuestions: res.data?.suggestedQuestions || res.suggestedQuestions || [],
        createdAt: new Date().toISOString()
      };

      setMessages((prev) =>
        prev.some((m) => m.id === streamMsgId)
          ? prev.map((m) => (m.id === streamMsgId ? assistantMsg : m))
          : [...prev, assistantMsg]
      );

      try {
        const convsRes = await fetchConversations();
        if (convsRes.data && Array.isArray(convsRes.data)) {
          const freshList = convsRes.data.map((c) => ({
            id: c.sessionId,
            title: c.title || 'Untitled Conversation',
            updatedAt: c.updatedAt || c.createdAt
          }));
          setConversations(freshList);
        }
      } catch (convFetchErr) {
        console.warn('Could not refresh conversations list:', convFetchErr);
      }
    } catch (err) {
      writer.cancel();
      clearPendingQuery(requestSessionId);

      if (activeRequestIdRef.current !== currentRequestId) return;
      if (activeConvIdRef.current !== requestSessionId) return;

      clearStepperTimers();

      console.error('Chat error:', err);
      const friendlyText = "Sorry, we couldn't generate your answer right now. Please try again later.";
      const errorMsg = {
        id: `err-${Date.now()}`,
        role: 'assistant',
        content: friendlyText,
        isError: true,
        sources: [],
        createdAt: new Date().toISOString()
      };
      setMessages((prev) => [...prev.filter((m) => m.id !== streamMsgId), errorMsg]);
      addToast(friendlyText, 'error');
    } finally {
      if (activeRequestIdRef.current === currentRequestId && activeConvIdRef.current === requestSessionId) {
        abortControllerRef.current = null;
        isSendingRef.current = false;
        setIsSending(false);
        setIsAnswerStreaming(false);
      }
    }
  };

  const handleRegenerateMessage = async (targetMsg, targetIndex) => {
    if (isSending || isSendingRef.current || regeneratingId) return;

    let userQuery = '';
    let userMsgObj = null;
    for (let i = targetIndex - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        userQuery = messages[i].content;
        userMsgObj = messages[i];
        break;
      }
    }

    if (!userQuery) {
      userMsgObj = [...messages].reverse().find((m) => m.role === 'user');
      userQuery = userMsgObj ? userMsgObj.content : '';
    }

    if (!userQuery) {
      addToast('Could not find original question to retry', 'error');
      return;
    }

    const requestSessionId = activeConvId;
    const targetMsgId = targetMsg.id || `assistant-${targetIndex}`;
    setRegeneratingId(targetMsgId);
    setIsSending(true);
    isSendingRef.current = true;
    const currentRequestId = ++activeRequestIdRef.current;
    const isCurrentRequest = () =>
      activeRequestIdRef.current === currentRequestId && activeConvIdRef.current === requestSessionId;
    setUnresolvedStatus(null);
    setShowRetryConfirm(false);

    setPendingQuery(requestSessionId, userQuery);

    setProgressSteps([
      { id: 'router', shortTitle: 'Understanding', title: 'Understanding your question', status: 'active', detail: 'Re-evaluating your question...' },
      { id: 'retrieval', shortTitle: 'Searching', title: 'Searching relevant information', status: 'pending', detail: 'Awaiting question analysis...' },
      { id: 'rerank', shortTitle: 'Checking', title: 'Checking relevant sources', status: 'pending', detail: 'Evaluating candidate sources...' },
      { id: 'llm', shortTitle: 'Preparing', title: 'Preparing your answer', status: 'pending', detail: 'Synthesizing response...' }
    ]);

    const timer1 = setTimeout(() => {
      if (isSendingRef.current && isCurrentRequest()) {
        setProgressSteps((prev) => [
          { ...prev[0], status: 'done', detail: 'Question understood' },
          { ...prev[1], status: 'active', detail: 'Searching relevant information...' },
          prev[2],
          prev[3]
        ]);
      }
    }, 700);

    const timer2 = setTimeout(() => {
      if (isSendingRef.current && isCurrentRequest()) {
        setProgressSteps((prev) => [
          prev[0],
          { ...prev[1], status: 'done', detail: 'Information found' },
          { ...prev[2], status: 'active', detail: 'Checking relevant sources...' },
          prev[3]
        ]);
      }
    }, 1500);

    const timer3 = setTimeout(() => {
      if (isSendingRef.current && isCurrentRequest()) {
        setProgressSteps((prev) => [
          prev[0],
          prev[1],
          { ...prev[2], status: 'done', detail: 'Sources checked' },
          { ...prev[3], status: 'active', detail: 'Preparing your answer...' }
        ]);
      }
    }, 2400);

    const clearStepperTimers = () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
    };

    const targetIdText = String(targetMsg.id || '');
    if (
      targetIdText &&
      !targetIdText.startsWith('assistant-') &&
      !targetIdText.startsWith('err-') &&
      !targetIdText.startsWith('stream-')
    ) {
      try {
        await truncateChatHistory(requestSessionId, targetMsg.id);
      } catch (truncErr) {
        console.warn('Failed to truncate history on server for retry:', truncErr);
      }
    }

    const writer = createStreamWriter((text) => {
      if (!isCurrentRequest() || !text) return;
      setMessages((prev) =>
        prev.map((m, idx) =>
          (m.id === targetMsg.id || idx === targetIndex)
            ? { ...m, content: text, isError: false, isStreaming: true, sources: [], suggestedQuestions: [] }
            : m
        )
      );
    });
    let firstTokenSeen = false;

    try {
      const activeDept = selectedDepartmentIdRef.current || selectedDepartmentId;
      const departmentIds = activeDept ? [String(activeDept)] : [];

      const controller = new AbortController();
      abortControllerRef.current = controller;

      const res = await sendChatMessageStream({
        message: userQuery,
        sessionId: requestSessionId,
        departmentIds,
        selectedDepartments: departmentIds,
        answerLength: answerLengthRef.current,
        visualMode: null,
        signal: controller.signal,
        onToken: (chunk) => {
          if (!isCurrentRequest()) return;
          if (!firstTokenSeen) {
            firstTokenSeen = true;
            setIsAnswerStreaming(true);
            clearStepperTimers();
          }
          writer.push(chunk);
        },
        onReset: () => {
          if (isCurrentRequest()) writer.reset();
        }
      });

      writer.cancel();
      clearPendingQuery(requestSessionId);

      if (activeRequestIdRef.current !== currentRequestId) return;
      if (activeConvIdRef.current !== requestSessionId) return;

      clearStepperTimers();

      setProgressSteps((prev) => prev.map((step) => ({ ...step, status: 'done' })));

      const updatedAssistantMsg = {
        id: res.assistantMessageId || (targetMsg.id && targetMsg.id.startsWith('err-') ? `assistant-${Date.now()}` : targetMsg.id) || `assistant-${Date.now()}`,
        role: 'assistant',
        content: res.data?.answer || res.answer || "I couldn't find relevant information in your connected documents.",
        sources: res.data?.sources || res.sources || [],
        intent: res.data?.intent || res.intent,
        timings: res.data?.timings || res.timings,
        suggestedQuestions: res.data?.suggestedQuestions || res.suggestedQuestions || [],
        isError: false,
        createdAt: new Date().toISOString()
      };

      setMessages((prev) =>
        prev.map((m, idx) => (m.id === targetMsg.id || idx === targetIndex ? updatedAssistantMsg : m))
      );
      addToast('Answer regenerated', 'success');
    } catch (err) {
      writer.cancel();
      clearPendingQuery(requestSessionId);

      if (activeRequestIdRef.current !== currentRequestId) return;
      if (activeConvIdRef.current !== requestSessionId) return;

      clearStepperTimers();

      console.error('Retry error:', err);
      const friendlyText = "Sorry, we couldn't generate your answer right now. Please try again later.";
      setMessages((prev) =>
        prev.map((m, idx) =>
          (m.id === targetMsg.id || idx === targetIndex)
            ? {
              ...m,
              isError: true,
              isStreaming: false,
              content: friendlyText,
              sources: []
            }
            : m
        )
      );
      addToast(friendlyText, 'error');
    } finally {
      if (activeRequestIdRef.current === currentRequestId && activeConvIdRef.current === requestSessionId) {
        abortControllerRef.current = null;
        setRegeneratingId(null);
        isSendingRef.current = false;
        setIsSending(false);
        setIsAnswerStreaming(false);
      }
    }
  };

  const handleUploadSubmit = async (formData) => {
    try {
      const res = await uploadDocuments(formData);
      addToast(res.message || 'Documents uploaded successfully', 'success');

      setIsDocsLoading(true);
      const [docsData, deptsData] = await Promise.all([
        fetchDocuments(),
        fetchDepartments()
      ]);
      setDocuments(docsData.data || []);
      setDepartments(deptsData.data || []);
    } catch (err) {
      console.error('Error uploading docs:', err);
      throw err;
    } finally {
      setIsDocsLoading(false);
    }
  };

  const handleReuploadDocument = async (doc, newFile, departmentIdsOverride) => {
    if (doc.source === 'google_drive') {
      try {
        await importDriveFile({
          fileId: doc.driveFileId,
          departmentIds: doc.departmentIds || [],
          forceReimport: true
        });
        addToast('Document re-imported from Google Drive', 'success');
        const docsData = await fetchDocuments();
        setDocuments(docsData.data || []);
      } catch (err) {
        console.error('Re-import error:', err);
        addToast(getFriendlyErrorMessage(err, 'drive'), 'error');
      }
    } else if (newFile) {
      try {
        const formData = new FormData();
        formData.append('files', newFile);
        const deptIds = departmentIdsOverride || doc.departmentIds || [];
        if (deptIds.length > 0) {
          formData.append('departmentIds', JSON.stringify(deptIds));
        }

        await uploadDocuments(formData);
        await deleteDocumentRecord(doc._id);

        addToast('Document updated successfully', 'success');

        const [docsData, deptsData] = await Promise.all([
          fetchDocuments(),
          fetchDepartments()
        ]);
        setDocuments(docsData.data || []);
        setDepartments(deptsData.data || []);
      } catch (err) {
        console.error('Re-upload failed:', err);
        throw err;
      }
    }
  };

  const handleTriggerDeleteDocument = (doc) => {
    if (!currentUser || currentUser.role !== 'admin') {
      addToast('Admin privileges required to delete documents.', 'error');
      return;
    }
    setConfirmDelete({
      isOpen: true,
      type: 'document',
      item: doc,
      title: 'Delete Document?',
      name: doc.filename || doc.originalFilename || doc.originalName || 'this file',
      warning: 'This will completely remove the document, its chunks, and vector index references from the knowledge base.'
    });
  };

  const handleDepartmentSubmit = async (payload) => {
    try {
      if (editingDept && editingDept._id) {
        const res = await updateDepartment(editingDept._id, payload);
        addToast(res.message || 'Department updated successfully', 'success');
      } else {
        const res = await createDepartment(payload);
        addToast(res.message || 'Department created successfully', 'success');
      }

      setIsDeptsLoading(true);
      const deptsData = await fetchDepartments();
      setDepartments(deptsData.data || []);
      setEditingDept(null);
    } catch (err) {
      console.error('Department save error:', err);
      addToast(getFriendlyErrorMessage(err, 'dept'), 'error');
      throw err;
    } finally {
      setIsDeptsLoading(false);
    }
  };

  const handleEditDepartment = (dept) => {
    if (!currentUser || currentUser.role !== 'admin') {
      addToast('Admin privileges required to edit departments.', 'error');
      return;
    }
    setEditingDept(dept);
    setShowDeptModal(true);
  };

  const handleTriggerDeleteDept = (dept) => {
    if (!currentUser || currentUser.role !== 'admin') {
      addToast('Admin privileges required to delete departments.', 'error');
      return;
    }
    setConfirmDelete({
      isOpen: true,
      type: 'department',
      item: dept,
      title: 'Delete Department?',
      name: `${dept.name} (${dept.code})`,
      warning: 'This action cannot be undone. Departments with active documents cannot be deleted.'
    });
  };

  const handleExecuteDelete = async () => {
    const { type, item } = confirmDelete;
    if (!type || !item) return;

    try {
      if (type === 'document') {
        await deleteDocumentRecord(item._id);
        setDocuments((prev) => prev.filter((d) => d._id !== item._id));
        addToast('Document deleted successfully', 'success');
      } else if (type === 'department') {
        await deleteDepartment(item._id);
        setDepartments((prev) => prev.filter((d) => d._id !== item._id));
        addToast('Department deleted successfully', 'success');
      } else if (type === 'conversation') {
        try {
          await deleteConversationRecord(item.id);
        } catch (delErr) {
          console.error('Failed to permanently delete conversation on server:', delErr);
        }
        clearPendingQuery(item.id);
        setConversations((prev) => prev.filter((c) => c.id !== item.id));
        setPinnedIds((prev) => prev.filter((id) => id !== item.id));
        if (activeConvId === item.id) {
          handleNewChat();
        }
        addToast('Conversation permanently deleted', 'info');
      } else if (type === 'user') {
        await deleteUserRecord(item._id);
        setUsersList((prev) => prev.filter((u) => u._id !== item._id));
        addToast('User account deleted permanently', 'success');
      }
    } catch (err) {
      console.error('Delete execution error:', err);
      addToast(getFriendlyErrorMessage(err, type === 'document' ? 'delete-doc' : 'delete-dept') || err.message, 'error');
    }
  };

  const activeDeptObj = departments.find((d) => (d._id || d.id) === selectedDepartmentId);
  const activeDeptName = activeDeptObj ? activeDeptObj.code : null;

  if (isAuthChecking) {
    return (
      <div className="auth-loading-screen">
        <Loader2 size={36} className="spin" style={{ color: 'var(--primary)' }} />
        <p className="auth-loading-text">Verifying session...</p>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <>
        <AuthModal
          isOpen={true}
          isGatekeeper={true}
          onLogin={handleLogin}
          onRegister={handleRegister}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
        <Toast toasts={toasts} onDismiss={removeToast} />
      </>
    );
  }

  return (
    <div className="app-shell">
      {/* 1. Sidebar Navigation */}
      <Sidebar
        activeView={activeView}
        setActiveView={setActiveView}
        conversations={conversations}
        activeConvId={activeConvId}
        setActiveConvId={setActiveConvId}
        onNewChat={handleNewChat}
        onRenameConversation={handleRenameConversation}
        onDeleteConversation={handleDeleteConversation}
        pinnedIds={pinnedIds}
        onTogglePinConversation={handleTogglePinConversation}
        searchQuery={searchConvQuery}
        setSearchQuery={setSearchConvQuery}
        documentCount={documents.length}
        departmentCount={departments.length}
        onOpenSettings={handleOpenSettingsModal}
        onOpenDrive={handleOpenDrive}
        isMobileOpen={isMobileSidebarOpen}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={toggleSidebarCollapse}
        currentUser={currentUser}
        onOpenAuth={() => setShowAuthModal(true)}
        onLogout={handleLogout}
        theme={theme}
        onSelectTheme={setTheme}
      />

      {/* 2. Main Content Viewport */}
      <main className="main-viewport">
        <ChatHeader
          departments={departments}
          selectedDepartmentId={selectedDepartmentId}
          setSelectedDepartmentId={handleSelectDepartment}
          onToggleSidebar={handleToggleSidebar}
          isSidebarCollapsed={isSidebarCollapsed}
          currentUser={currentUser}
          activeViewTitle={
            activeView === 'documents'
              ? 'Knowledge Base'
              : activeView === 'departments'
                ? 'Departments'
                : activeView === 'users'
                  ? 'User Management'
                  : activeView === 'audit-logs'
                    ? 'Security & Audit Logs'
                    : null
          }
        />

        {/* View Router */}
        {activeView === 'chat' && (
          <div className="chat-view-layout">
            {messages.length === 0 ? (
              <div className="chat-empty-scroll-wrap">
                <div className="chat-content-width">
                  <div className="chat-empty-greeting-wrap">
                    <ChatHome />
                    <ChatComposer
                      inputQuery={inputQuery}
                      setInputQuery={setInputQuery}
                      onSendMessage={() => handleSendMessage()}
                      onStopGeneration={handleStopGeneration}
                      onOpenUpload={currentUser?.role === 'admin' ? handleOpenUpload : undefined}
                      onOpenDrive={currentUser?.role === 'admin' ? handleOpenDrive : undefined}
                      isSending={isSending}
                      selectedDepartmentName={activeDeptName}
                      visualMode={visualMode}
                      setVisualMode={setVisualMode}
                      answerLength={answerLength}
                      setAnswerLength={setAnswerLength}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="chat-active-flex-column">
                <div
                  className="chat-messages-scroll-area"
                  ref={messagesContainerRef}
                  onScroll={handleMessagesScroll}
                >
                  <div className="chat-content-width">
                    <div className="chat-messages-list">
                      {messages.map((msg, index) => (
                        <MessageItem
                          key={msg.id || index}
                          message={msg}
                          isRegenerating={regeneratingId === (msg.id || `assistant-${index}`)}
                          onRegenerate={
                            msg.role === 'assistant'
                              ? () => handleRegenerateMessage(msg, index)
                              : null
                          }
                          onEdit={handleStartEditMessage}
                          onToast={addToast}
                          onSendQuery={handleSendMessage}
                          handleSendMessage={handleSendMessage}
                        />
                      ))}

                      {/* Processing Stepper */}
                      {isSending && !regeneratingId && !isAnswerStreaming && !messages.some((m) => m.isStreaming) && (
                        <div className="message-row assistant">
                          <div
                            className="message-bubble assistant"
                            style={{
                              minWidth: '420px',
                              maxWidth: '560px',
                              padding: '14px 18px'
                            }}
                          >
                            <div className="assistant-identity" style={{ marginBottom: '6px' }}>
                              <div className="assistant-avatar-badge">
                                <span style={{ fontSize: '0.65rem', fontWeight: '700' }}>AI</span>
                              </div>
                              <span className="assistant-title-text">Assistant</span>
                              <span
                                className="assistant-thinking-text"
                                style={{ color: 'var(--primary)', fontWeight: 600 }}
                              >
                                Processing...
                              </span>
                            </div>

                            <HorizontalStepper steps={progressSteps} />
                          </div>
                        </div>
                      )}

                      {/* Generation Recovery Card */}
                      {(() => {
                        if (isSending || isHistoryLoading || regeneratingId) return null;
                        const isUnknown = unresolvedStatus?.type === 'unknown' && unresolvedStatus?.sessionId === activeConvId;
                        const isLastMsgUser = messages.length > 0 && messages[messages.length - 1].role === 'user';
                        const lastMsg = messages[messages.length - 1];
                        const msgAgeMs = lastMsg?.createdAt ? Date.now() - new Date(lastMsg.createdAt).getTime() : Infinity;
                        const isWithinGenerationWindow = msgAgeMs < 90000;
                        const isInterrupted = !isUnknown && isLastMsgUser && !getPendingQuery(activeConvId) && !isWithinGenerationWindow;

                        if (!isUnknown && !isInterrupted) return null;

                        const targetUserMsg = messages[messages.length - 1];

                        return (
                          <div className="message-row assistant">
                            <div className="message-bubble assistant" style={{ width: '100%', maxWidth: '560px', padding: 0 }}>
                              <div className="assistant-identity" style={{ marginBottom: '6px' }}>
                                <div className="assistant-avatar-badge">
                                  <span style={{ fontSize: '0.65rem', fontWeight: '700' }}>AI</span>
                                </div>
                                <span className="assistant-title-text">Assistant</span>
                              </div>

                              <div className={`generation-recovery-card ${isInterrupted ? 'interrupted' : 'unknown'}`} role="status">
                                <div className="recovery-header">
                                  <AlertCircle size={16} className="recovery-icon" aria-hidden="true" />
                                  <span className="recovery-title">
                                    {isUnknown ? 'Generation status unknown' : 'Generation interrupted'}
                                  </span>
                                </div>

                                <p className="recovery-description">
                                  {isUnknown
                                    ? "Your question may still be processing, but we couldn't confirm the result. Please check again before retrying to avoid submitting the same question twice."
                                    : "Generation was interrupted before an answer was saved. You can check if the response is available or retry the question."}
                                </p>

                                {showRetryConfirm && isUnknown ? (
                                  <div className="recovery-confirm-box">
                                    <p className="recovery-confirm-text">
                                      The original request may still be processing on the server. Are you sure you want to retry now?
                                    </p>
                                    <div className="recovery-confirm-actions">
                                      <button
                                        type="button"
                                        className="btn-recovery-action"
                                        onClick={() => setShowRetryConfirm(false)}
                                      >
                                        Cancel
                                      </button>
                                      <button
                                        type="button"
                                        className="btn-recovery-action primary"
                                        onClick={() => {
                                          setShowRetryConfirm(false);
                                          handleRetryOrphaned(targetUserMsg);
                                        }}
                                      >
                                        Confirm Retry
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="recovery-actions-row">
                                    <button
                                      type="button"
                                      className="btn-recovery-action"
                                      onClick={handleCheckStatus}
                                      disabled={isCheckingStatus}
                                      title="Fetch latest session history"
                                    >
                                      <RotateCcw size={13} className={isCheckingStatus ? 'spin-icon' : ''} />
                                      <span>{isCheckingStatus ? 'Checking...' : 'Check status'}</span>
                                    </button>

                                    <button
                                      type="button"
                                      className="btn-recovery-action primary"
                                      onClick={() => {
                                        if (isUnknown) {
                                          setShowRetryConfirm(true);
                                        } else {
                                          handleRetryOrphaned(targetUserMsg);
                                        }
                                      }}
                                      disabled={isSending}
                                      title={isUnknown ? 'Retry (with warning)' : 'Resend question'}
                                    >
                                      <RotateCcw size={13} />
                                      <span>Retry</span>
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })()}

                      <div ref={messagesEndRef} className="messages-bottom-anchor" />
                    </div>
                  </div>
                </div>

                <div className="chat-composer-row">
                  <div className="chat-content-width">
                    {editingMessage && (
                      <div className="composer-editing-banner">
                        <div className="composer-editing-banner-text">
                          <Pencil size={13} />
                          <span>Editing question. Submitting will update the conversation branch.</span>
                        </div>
                        <button
                          type="button"
                          className="composer-editing-cancel-btn"
                          onClick={handleCancelEdit}
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                    <ChatComposer
                      inputQuery={inputQuery}
                      setInputQuery={setInputQuery}
                      onSendMessage={() => handleSendMessage()}
                      onStopGeneration={handleStopGeneration}
                      onOpenUpload={currentUser?.role === 'admin' ? handleOpenUpload : undefined}
                      onOpenDrive={currentUser?.role === 'admin' ? handleOpenDrive : undefined}
                      isSending={isSending}
                      selectedDepartmentName={activeDeptName}
                      visualMode={visualMode}
                      setVisualMode={setVisualMode}
                      answerLength={answerLength}
                      setAnswerLength={setAnswerLength}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {activeView === 'documents' && currentUser?.role === 'admin' && (
          <DocumentsView
            documents={documents}
            departments={departments}
            isLoading={isDocsLoading}
            onOpenUpload={handleOpenUpload}
            onOpenDrive={handleOpenDrive}
            onDeleteDocument={handleTriggerDeleteDocument}
            onReuploadDocument={handleReuploadDocument}
            onOpenReupload={(doc) => {
              if (!currentUser || currentUser.role !== 'admin') {
                addToast('Admin privileges required to re-upload documents.', 'error');
                return;
              }
              setReuploadDoc(doc);
              setShowUploadModal(true);
            }}
            currentUser={currentUser}
          />
        )}

        {activeView === 'departments' && currentUser?.role === 'admin' && (
          <DepartmentsView
            departments={departments}
            documents={documents}
            isLoading={isDeptsLoading}
            onOpenCreateDept={handleOpenCreateDept}
            onEditDept={handleEditDepartment}
            onDeleteDept={handleTriggerDeleteDept}
            currentUser={currentUser}
          />
        )}

        {/* 3. Admin-Only Users View */}
        {activeView === 'users' && currentUser?.role === 'admin' && (
          <UsersView
            users={usersList}
            departments={departments}
            isLoading={isUsersLoading}
            onCreateUser={handleCreateUser}
            onToggleStatus={handleToggleUserStatus}
            onDeleteUser={handleTriggerDeleteUser}
            currentUser={currentUser}
          />
        )}

        {/* 4. Admin-Only Security & Audit Logs View */}
        {activeView === 'audit-logs' && currentUser?.role === 'admin' && (
          <AuditLogsView />
        )}
      </main>

      {/* 5. Modals */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        onLogin={handleLogin}
        onRegister={handleRegister}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      <UploadModal
        isOpen={showUploadModal}
        onClose={() => {
          setShowUploadModal(false);
          setReuploadDoc(null);
        }}
        departments={departments}
        onUploadSuccess={handleUploadSubmit}
        onToast={addToast}
        reuploadDoc={reuploadDoc}
        onReupload={handleReuploadDocument}
      />

      <GoogleDriveModal
        isOpen={showDriveModal}
        onClose={() => setShowDriveModal(false)}
        departments={departments}
        onImportSuccess={async () => {
          const docsData = await fetchDocuments().catch(() => ({ data: [] }));
          setDocuments(docsData.data || []);
        }}
        onToast={addToast}
      />

      <DepartmentModal
        isOpen={showDeptModal}
        onClose={() => {
          setShowDeptModal(false);
          setEditingDept(null);
        }}
        onSubmit={handleDepartmentSubmit}
        department={editingDept}
      />

      <ConfirmModal
        isOpen={confirmDelete.isOpen}
        onClose={() => setConfirmDelete({ ...confirmDelete, isOpen: false })}
        onConfirm={handleExecuteDelete}
        title={confirmDelete.title}
        itemName={confirmDelete.name}
        warningText={confirmDelete.warning}
      />
      
      <SettingsModal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        initialTab={settingsTab}
        theme={theme}
        onSelectTheme={setTheme}
        currentUser={currentUser}
        onUpdateProfile={handleUpdateProfile}
        onClearConversation={() => {
          setShowSettingsModal(false);
          handleDeleteConversation(activeConvId);
        }}
        hasActiveMessages={messages.length > 0}
      />

      {/* 6. Toasts */}
      <Toast toasts={toasts} onDismiss={removeToast} />
    </div>
  );
}