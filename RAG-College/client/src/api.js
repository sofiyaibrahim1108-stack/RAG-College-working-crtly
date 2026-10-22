const API_BASE = 'http://localhost:5000/api';
const TOKEN_KEY = 'rag_college_token';

export function getAuthToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token) {
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch (err) {
    console.warn('Could not persist auth token', err);
  }
}

export function removeAuthToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}

function getAuthHeaders(headers = {}) {
  const token = getAuthToken();
  const merged = { ...headers };
  if (token) {
    merged['Authorization'] = `Bearer ${token}`;
  }
  return merged;
}

export async function loginUser(credentials) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Login failed');
  if (data.token) {
    setAuthToken(data.token);
  }
  return data;
}

export async function registerUser(payload) {
  const res = await fetch(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Registration failed');
  return data;
}

export async function fetchCurrentUser() {
  const token = getAuthToken();
  if (!token) return null;

  try {
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: getAuthHeaders()
    });

    if (res.status === 401 || res.status === 403) {
      removeAuthToken();
      return null;
    }

    if (!res.ok) {
      return null;
    }

    const data = await res.json();
    return data.user || null;
  } catch (err) {
    console.warn('Failed to verify current user session:', err);
    return null;
  }
}

export function logoutUser() {
  removeAuthToken();
}

export async function fetchHealth() {
  const res = await fetch(`${API_BASE}/health`, {
    headers: getAuthHeaders()
  });
  if (!res.ok) throw new Error('Failed to fetch system health');
  return res.json();
}

export async function fetchDepartments() {
  const res = await fetch(`${API_BASE}/departments`, {
    headers: getAuthHeaders()
  });
  if (!res.ok) throw new Error('Failed to fetch departments');
  return res.json();
}

export async function createDepartment(payload) {
  const res = await fetch(`${API_BASE}/departments`, {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to create department');
  return data;
}

export async function updateDepartment(id, payload) {
  const res = await fetch(`${API_BASE}/departments/${id}`, {
    method: 'PUT',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to update department');
  return data;
}

export async function deleteDepartment(id) {
  const res = await fetch(`${API_BASE}/departments/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders()
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to delete department');
  return data;
}

export async function fetchDocuments(params = {}) {
  const query = new URLSearchParams();
  if (params.departmentId) query.append('departmentId', params.departmentId);
  if (params.status) query.append('status', params.status);
  if (params.search) query.append('search', params.search);

  const res = await fetch(`${API_BASE}/documents?${query.toString()}`, {
    headers: getAuthHeaders()
  });
  if (!res.ok) throw new Error('Failed to fetch documents');
  return res.json();
}

export async function uploadDocuments(formData) {
  const res = await fetch(`${API_BASE}/documents/upload`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: formData
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Upload failed');
  return data;
}

export async function deleteDocumentRecord(id) {
  const res = await fetch(`${API_BASE}/documents/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders()
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to delete document');
  return data;
}

export function mapAnswerLengthToPayload(answerLength) {
  if (!answerLength) return null;
  const str = String(answerLength).trim().toLowerCase();
  if (str === 'short') return 'short';
  if (str === 'medium') return 'medium';
  if (str === 'detailed') return 'detailed';
  return null;
}

export function mapVisualModeToPayload(visualMode) {
  if (!visualMode || visualMode === 'auto') return null;
  const str = String(visualMode).trim().toLowerCase();
  if (['text_only', 'image_only', 'both'].includes(str)) return str;
  return null;
}

// Phase 3 Chat API (non-streaming, kept for compatibility)
export async function sendChatMessage({
  message,
  sessionId,
  departmentIds = [],
  documentId = null,
  answerLength = 'Auto',
  visualMode = null
}) {
  const res = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      message,
      sessionId,
      departmentIds,
      documentId,
      answerLength: mapAnswerLengthToPayload(answerLength),
      visualMode: mapVisualModeToPayload(visualMode)
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to send chat message');
  return data;
}

// Streaming Chat API (Server-Sent Events over fetch).
// onToken(text) is called for every piece of the answer as it is generated,
// onReset() is called when the server restarts the answer (for example a retry),
// and the returned promise resolves with the same payload sendChatMessage returns.
export async function sendChatMessageStream({
  message,
  sessionId,
  departmentIds = [],
  documentId = null,
  answerLength = 'Auto',
  visualMode = null,
  onToken = null,
  onReset = null,
  signal = undefined
}) {
  const res = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: getAuthHeaders({
      'Content-Type': 'application/json',
      Accept: 'text/event-stream'
    }),
    body: JSON.stringify({
      message,
      sessionId,
      departmentIds,
      documentId,
      answerLength: mapAnswerLengthToPayload(answerLength),
      visualMode: mapVisualModeToPayload(visualMode),
      stream: true
    }),
    signal
  });

  if (!res.ok) {
    let errorMessage = 'Failed to send chat message';
    try {
      const data = await res.json();
      errorMessage = data.message || errorMessage;
    } catch (_) {
      // response was not JSON
    }
    throw new Error(errorMessage);
  }

  if (!res.body) {
    throw new Error('Streaming is not supported by this browser');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalPayload = null;

  // One SSE frame looks like:  event: token\ndata: {"text":"..."}
  const handleFrame = (frame) => {
    let eventName = 'message';
    const dataLines = [];

    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
    }

    if (dataLines.length === 0) return;

    let data;
    try {
      data = JSON.parse(dataLines.join('\n'));
    } catch (_) {
      return;
    }

    if (eventName === 'token') {
      if (typeof onToken === 'function') onToken(data.text || '');
    } else if (eventName === 'reset') {
      if (typeof onReset === 'function') onReset();
    } else if (eventName === 'done') {
      finalPayload = data;
    } else if (eventName === 'error') {
      throw new Error(data.message || 'Chat stream failed');
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

    let separatorIndex;
    while ((separatorIndex = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      handleFrame(frame);
    }
  }

  if (buffer.trim()) handleFrame(buffer);

  if (!finalPayload) {
    throw new Error('Chat stream ended before the answer was complete');
  }

  return finalPayload;
}

export async function fetchChatHistory(sessionId) {
  const res = await fetch(`${API_BASE}/chat/history/${sessionId}`, {
    headers: getAuthHeaders()
  });
  if (!res.ok) throw new Error('Failed to fetch chat history');
  return res.json();
}

export async function fetchConversations() {
  const res = await fetch(`${API_BASE}/chat/conversations`, {
    headers: getAuthHeaders()
  });
  if (!res.ok) throw new Error('Failed to fetch conversations');
  return res.json();
}

export async function deleteConversationRecord(sessionId) {
  const res = await fetch(`${API_BASE}/chat/conversations/${sessionId}`, {
    method: 'DELETE',
    headers: getAuthHeaders()
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to delete conversation');
  return data;
}

export async function truncateChatHistory(sessionId, messageId) {
  const res = await fetch(`${API_BASE}/chat/history/${sessionId}/from/${messageId}`, {
    method: 'DELETE',
    headers: getAuthHeaders()
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to truncate conversation history');
  return data;
}

// Phase 5 Google Drive APIs
export async function fetchDriveStatus() {
  const res = await fetch(`${API_BASE}/drive/status`, {
    headers: getAuthHeaders()
  });
  if (!res.ok) throw new Error('Failed to fetch Google Drive status');
  return res.json();
}

export async function fetchDriveAuthUrl() {
  const res = await fetch(`${API_BASE}/drive/auth`, {
    headers: getAuthHeaders()
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to fetch authorization URL');
  return data;
}

export async function disconnectDrive() {
  const res = await fetch(`${API_BASE}/drive/disconnect`, {
    method: 'POST',
    headers: getAuthHeaders()
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to disconnect Google Drive');
  return data;
}

export async function fetchDriveFiles(params = {}) {
  const query = new URLSearchParams();
  if (params.search) query.append('search', params.search);
  if (params.pageToken) query.append('pageToken', params.pageToken);
  if (params.pageSize) query.append('pageSize', params.pageSize);

  const res = await fetch(`${API_BASE}/drive/files?${query.toString()}`, {
    headers: getAuthHeaders()
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to fetch Google Drive files');
  return data;
}

export async function importDriveFile({ fileId, departmentIds, forceReimport = false }) {
  const res = await fetch(`${API_BASE}/drive/import`, {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ fileId, departmentIds, forceReimport })
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.message || 'Failed to import document from Google Drive');
    err.duplicate = data.duplicate;
    err.data = data.data;
    throw err;
  }
  return data;
}