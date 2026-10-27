import React, { useState, useEffect } from 'react';
import {
  X,
  Sun,
  Moon,
  Palette,
  User,
  Shield,
  Lock,
  Mail,
  KeyRound,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Trash2,
  Check,
  Eye,
  EyeOff
} from 'lucide-react';

/* ------------------------------------------------------------------
   Styles (kept in this file so no separate CSS is needed).
   Colours read your existing CSS variables first, with fallbacks,
   so light / dark themes keep working.
------------------------------------------------------------------ */
const SM_CSS = `
@keyframes sm-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes sm-pop  { from { opacity: 0; transform: translateY(8px) scale(.985); } to { opacity: 1; transform: none; } }
@keyframes sm-spin { to { transform: rotate(360deg); } }

.sm-backdrop {
  position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center;
  padding: 24px; background: rgba(15, 23, 42, .55); backdrop-filter: blur(4px); animation: sm-fade .15s ease;
}
.sm-modal {
  --sm-text: var(--text, #0f172a);
  --sm-muted: var(--text-secondary, #64748b);
  --sm-faint: var(--text-muted, #94a3b8);
  --sm-border: var(--border, #e2e8f0);
  --sm-surface: var(--surface, #ffffff);
  --sm-subtle: var(--surface-hover, #f8fafc);
  --sm-primary: var(--primary, #2563eb);
  --sm-primary-bg: var(--primary-light, #eff6ff);
  --sm-ring: rgba(37, 99, 235, .18);
  --sm-red: var(--danger, #dc2626);
  --sm-red-bg: var(--danger-light, #fef2f2);
  --sm-red-bd: var(--danger-border, #fecaca);
  --sm-green: var(--status-ready, #059669);
  --sm-green-bg: var(--status-ready-bg, #ecfdf5);
  --sm-green-bd: var(--status-ready-border, #a7f3d0);

  display: flex; flex-direction: column; width: 720px; max-width: 100%; height: min(86vh, 600px);
  background: var(--sm-surface); color: var(--sm-text); border-radius: 16px; overflow: hidden;
  box-shadow: 0 24px 60px -12px rgba(15, 23, 42, .4), 0 0 0 1px rgba(15, 23, 42, .06);
  animation: sm-pop .18s ease;
}
.sm-modal button, .sm-modal input { font-family: inherit; }

/* Header */
.sm-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px 16px 24px; border-bottom: 1px solid var(--sm-border);
}
.sm-title { margin: 0; font-size: 17px; font-weight: 650; letter-spacing: -.01em; }
.sm-close {
  width: 32px; height: 32px; border: none; border-radius: 8px; background: transparent; color: var(--sm-muted);
  display: flex; align-items: center; justify-content: center; cursor: pointer; transition: background .12s, color .12s;
}
.sm-close:hover { background: var(--sm-subtle); color: var(--sm-text); }
.sm-close:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--sm-ring); }

/* Layout */
.sm-body { display: flex; flex: 1; min-height: 0; }
.sm-nav {
  width: 210px; flex-shrink: 0; display: flex; flex-direction: column; gap: 2px;
  padding: 14px 10px; background: var(--sm-subtle); border-right: 1px solid var(--sm-border);
}
.sm-nav-btn {
  display: flex; align-items: center; gap: 10px; padding: 9px 12px; border: none; border-radius: 9px;
  background: transparent; color: var(--sm-muted); font-size: 14px; font-weight: 500; text-align: left; cursor: pointer;
  white-space: nowrap; transition: background .12s, color .12s, box-shadow .12s;
}
.sm-nav-btn:hover:not(.active) { color: var(--sm-text); background: rgba(100, 116, 139, .08); }
.sm-nav-btn.active {
  background: var(--sm-surface); color: var(--sm-primary); font-weight: 600;
  box-shadow: 0 1px 2px rgba(15, 23, 42, .08), 0 0 0 1px rgba(15, 23, 42, .04);
}
.sm-nav-btn:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--sm-ring); }

.sm-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.sm-form { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.sm-scroll {
  flex: 1; min-height: 0; overflow-y: auto; padding: 24px 28px;
  display: flex; flex-direction: column; gap: 20px;
  scrollbar-width: thin; scrollbar-color: #cbd5e1 transparent;
}
.sm-scroll::-webkit-scrollbar { width: 8px; }
.sm-scroll::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 8px; border: 2px solid var(--sm-surface); }

.sm-section-title { margin: 0; font-size: 16px; font-weight: 650; }
.sm-section-sub { margin: 4px 0 0; font-size: 13.5px; line-height: 1.5; color: var(--sm-muted); }

/* Cards */
.sm-card { border: 1px solid var(--sm-border); border-radius: 12px; background: var(--sm-surface); }
.sm-card-pad { padding: 16px 18px; }
.sm-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.sm-row-title { font-size: 14px; font-weight: 600; }
.sm-row-sub { margin-top: 2px; font-size: 13px; line-height: 1.45; color: var(--sm-muted); }

/* Identity */
.sm-identity { display: flex; align-items: center; gap: 14px; padding: 16px 18px; background: var(--sm-subtle); }
.sm-avatar {
  flex-shrink: 0; width: 48px; height: 48px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: var(--sm-primary-bg); color: var(--sm-primary); font-size: 16px; font-weight: 700;
  box-shadow: inset 0 0 0 1px rgba(37, 99, 235, .15);
}
.sm-id-text { flex: 1; min-width: 0; }
.sm-id-name { font-size: 15px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sm-id-email {
  display: flex; align-items: center; gap: 6px; margin-top: 2px; font-size: 13px; color: var(--sm-muted);
  overflow: hidden; white-space: nowrap;
}
.sm-id-email span { overflow: hidden; text-overflow: ellipsis; }
.sm-chip {
  display: inline-flex; align-items: center; gap: 5px; flex-shrink: 0; padding: 3px 9px;
  border: 1px solid var(--sm-border); border-radius: 999px; background: var(--sm-surface);
  font-size: 12px; font-weight: 600; color: var(--sm-muted);
}

/* Fields */
.sm-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.sm-label { font-size: 13px; font-weight: 600; color: var(--sm-text); }
.sm-hint { margin: 0; font-size: 12px; color: var(--sm-muted); }
.sm-hint.err { color: var(--sm-red); }
.sm-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.sm-stack { display: flex; flex-direction: column; gap: 14px; }

.sm-input-wrap { position: relative; display: flex; align-items: center; }
.sm-input-wrap > .sm-icon { position: absolute; left: 13px; color: var(--sm-faint); pointer-events: none; transition: color .12s; }
.sm-input-wrap:focus-within > .sm-icon { color: var(--sm-primary); }
.sm-modal .sm-input {
  width: 100%; height: 42px; padding: 0 12px 0 38px; border: 1px solid var(--sm-border); border-radius: 10px;
  background: var(--sm-surface); color: var(--sm-text); font-size: 14px; outline: none; box-sizing: border-box;
  transition: border-color .12s, box-shadow .12s;
}
.sm-modal .sm-input.pr { padding-right: 42px; }
.sm-modal .sm-input::placeholder { color: var(--sm-faint); }
.sm-modal .sm-input:hover:not(:focus) { border-color: var(--sm-faint); }
.sm-modal .sm-input:focus { border-color: var(--sm-primary); box-shadow: 0 0 0 3px var(--sm-ring); }
.sm-modal .sm-input.invalid { border-color: var(--sm-red); }
.sm-modal .sm-input.invalid:focus { box-shadow: 0 0 0 3px rgba(220, 38, 38, .15); }
.sm-eye {
  position: absolute; right: 6px; width: 30px; height: 30px; border: none; border-radius: 8px; background: transparent;
  color: var(--sm-faint); display: flex; align-items: center; justify-content: center; cursor: pointer;
  transition: background .12s, color .12s;
}
.sm-eye:hover { background: var(--sm-subtle); color: var(--sm-text); }
.sm-eye:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--sm-ring); }

.sm-pw-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
.sm-pw-title { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; }
.sm-pw-title svg { color: var(--sm-primary); }
.sm-optional { font-size: 12px; color: var(--sm-faint); }

/* Theme picker */
.sm-theme-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.sm-theme-card {
  position: relative; display: flex; flex-direction: column; gap: 10px; padding: 10px 10px 12px; text-align: left;
  border: 1px solid var(--sm-border); border-radius: 12px; background: var(--sm-surface); color: var(--sm-text);
  cursor: pointer; transition: border-color .12s, box-shadow .12s;
}
.sm-theme-card:hover:not(.active) { border-color: var(--sm-faint); }
.sm-theme-card.active { border-color: var(--sm-primary); box-shadow: 0 0 0 3px var(--sm-ring); }
.sm-theme-card:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--sm-ring); }
.sm-theme-label { display: flex; align-items: center; gap: 8px; padding: 0 4px; font-size: 14px; font-weight: 600; }
.sm-theme-tick {
  position: absolute; top: 16px; right: 16px; width: 20px; height: 20px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center; background: var(--sm-primary); color: #fff;
}
.sm-tp { display: flex; height: 92px; border-radius: 8px; overflow: hidden; border: 1px solid rgba(100, 116, 139, .25); }
.sm-tp-side { width: 26%; }
.sm-tp-main { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 7px; padding: 0 14px; }
.sm-tp-main i { display: block; height: 7px; border-radius: 4px; }
.sm-tp.light .sm-tp-side { background: #0f172a; }
.sm-tp.light .sm-tp-main { background: #ffffff; }
.sm-tp.light .sm-tp-main i { background: #e2e8f0; }
.sm-tp.light .sm-tp-main i:first-child { background: #2563eb; width: 40%; }
.sm-tp.dark .sm-tp-side { background: #020617; }
.sm-tp.dark .sm-tp-main { background: #0f172a; }
.sm-tp.dark .sm-tp-main i { background: #1e293b; }
.sm-tp.dark .sm-tp-main i:first-child { background: #3b82f6; width: 40%; }
.sm-tp-main i:nth-child(2) { width: 85%; }
.sm-tp-main i:nth-child(3) { width: 60%; }

/* Danger row */
.sm-danger-icon {
  flex-shrink: 0; width: 38px; height: 38px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center; background: var(--sm-red-bg); color: var(--sm-red);
}
.sm-row-left { display: flex; align-items: center; gap: 14px; min-width: 0; }

/* Buttons */
.sm-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 40px; padding: 0 18px;
  border-radius: 10px; font-size: 14px; font-weight: 600; cursor: pointer; white-space: nowrap;
  transition: background .12s, border-color .12s, color .12s, box-shadow .12s, transform .05s;
}
.sm-btn:active:not(:disabled) { transform: translateY(1px); }
.sm-btn:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--sm-ring); }
.sm-btn:disabled { opacity: .5; cursor: not-allowed; }
.sm-btn-primary {
  background: var(--sm-primary); border: 1px solid var(--sm-primary); color: #fff;
  box-shadow: 0 1px 2px rgba(37, 99, 235, .25), inset 0 1px 0 rgba(255, 255, 255, .12);
}
.sm-btn-primary:hover:not(:disabled) { filter: brightness(.93); }
.sm-btn-danger { background: transparent; border: 1px solid var(--sm-red-bd); color: var(--sm-red); height: 36px; padding: 0 14px; }
.sm-btn-danger:hover:not(:disabled) { background: var(--sm-red-bg); }

/* Footer + status */
.sm-footer {
  display: flex; align-items: center; justify-content: space-between; gap: 14px;
  padding: 14px 28px; border-top: 1px solid var(--sm-border); background: var(--sm-subtle);
}
.sm-status { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; font-size: 13px; font-weight: 500; line-height: 1.4; }
.sm-status.error { color: var(--sm-red); }
.sm-status.success { color: var(--sm-green); }
.sm-status svg { flex-shrink: 0; }
.sm-spin { animation: sm-spin .8s linear infinite; }

@media (max-width: 640px) {
  .sm-backdrop { padding: 12px; }
  .sm-modal { height: 92vh; }
  .sm-body { flex-direction: column; }
  .sm-nav { width: auto; flex-direction: row; overflow-x: auto; padding: 10px; border-right: none; border-bottom: 1px solid var(--sm-border); }
  .sm-scroll { padding: 20px 18px; }
  .sm-footer { padding: 12px 18px; }
  .sm-grid-2, .sm-theme-grid { grid-template-columns: 1fr; }
  .sm-row { flex-wrap: wrap; }
}
@media (prefers-reduced-motion: reduce) {
  .sm-backdrop, .sm-modal { animation: none; }
  .sm-spin { animation-duration: 2s; }
}
`;

const NAV_ITEMS = [
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'profile', label: 'Profile & account', icon: User },
  { id: 'data', label: 'Data controls', icon: Shield }
];

function getInitials(name) {
  if (!name) return 'U';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function PasswordField({ id, label, value, onChange, placeholder, autoComplete, invalid, hint }) {
  const [show, setShow] = useState(false);
  return (
    <div className="sm-field">
      <label className="sm-label" htmlFor={id}>{label}</label>
      <div className="sm-input-wrap">
        <Lock size={16} className="sm-icon" />
        <input
          id={id}
          type={show ? 'text' : 'password'}
          className={`sm-input pr${invalid ? ' invalid' : ''}`}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          autoComplete={autoComplete}
        />
        <button
          type="button"
          className="sm-eye"
          onClick={() => setShow((s) => !s)}
          tabIndex={-1}
          aria-label={show ? 'Hide password' : 'Show password'}
        >
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      {hint && <p className={`sm-hint${invalid ? ' err' : ''}`}>{hint}</p>}
    </div>
  );
}

export default function SettingsModal({
  isOpen,
  onClose,
  initialTab = 'appearance',
  theme = 'dark',
  onSelectTheme,
  currentUser = null,
  onUpdateProfile,
  onClearConversation,
  hasActiveMessages = false
}) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [name, setName] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState({ type: '', text: '' });

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab || 'appearance');
      setName(currentUser?.name || '');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setStatusMsg({ type: '', text: '' });
    }
  }, [isOpen, initialTab, currentUser]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleProfileSubmit = async (e) => {
    e.preventDefault();
    setStatusMsg({ type: '', text: '' });

    if (!name.trim()) {
      setStatusMsg({ type: 'error', text: 'Name cannot be empty.' });
      return;
    }

    if (newPassword && newPassword !== confirmPassword) {
      setStatusMsg({ type: 'error', text: 'New passwords do not match.' });
      return;
    }

    if (newPassword && newPassword.length < 6) {
      setStatusMsg({ type: 'error', text: 'Password must be at least 6 characters long.' });
      return;
    }

    setIsSaving(true);
    try {
      if (onUpdateProfile) {
        await onUpdateProfile({
          name: name.trim(),
          currentPassword: currentPassword || undefined,
          newPassword: newPassword || undefined
        });
      }
      setStatusMsg({ type: 'success', text: 'Profile changes saved successfully!' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setStatusMsg({
        type: 'error',
        text: err.response?.data?.message || err.message || 'Failed to update profile.'
      });
    } finally {
      setIsSaving(false);
    }
  };

  const nameChanged = name.trim() !== (currentUser?.name || '');
  const hasPasswordInput = Boolean(currentPassword || newPassword || confirmPassword);
  const canSave = (nameChanged || hasPasswordInput) && !isSaving;
  const mismatch = Boolean(confirmPassword) && newPassword !== confirmPassword;
  const roleLabel = currentUser?.role === 'admin' ? 'Administrator' : currentUser?.role ? 'User' : '';

  const switchTab = (id) => {
    setActiveTab(id);
    setStatusMsg({ type: '', text: '' });
  };

  return (
    <div className="sm-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="sm-title">
      <style>{SM_CSS}</style>
      <div className="sm-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="sm-header">
          <h2 className="sm-title" id="sm-title">Settings</h2>
          <button type="button" className="sm-close" onClick={onClose} aria-label="Close settings">
            <X size={18} />
          </button>
        </div>

        <div className="sm-body">
          {/* Left nav */}
          <div className="sm-nav" role="tablist" aria-orientation="vertical">
            {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={activeTab === id}
                className={`sm-nav-btn${activeTab === id ? ' active' : ''}`}
                onClick={() => switchTab(id)}
              >
                <Icon size={16} />
                <span>{label}</span>
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="sm-main">
            {/* 1. APPEARANCE */}
            {activeTab === 'appearance' && (
              <div className="sm-scroll">
                <div>
                  <h3 className="sm-section-title">Theme</h3>
                  <p className="sm-section-sub">
                    Choose how the interface looks. Currently using {theme === 'dark' ? 'dark' : 'light'} mode.
                  </p>
                </div>

                <div className="sm-theme-grid" role="radiogroup" aria-label="Interface theme">
                  {[
                    { id: 'light', label: 'Light', icon: Sun, color: '#d97706' },
                    { id: 'dark', label: 'Dark', icon: Moon, color: '#3b82f6' }
                  ].map(({ id, label, icon: Icon, color }) => (
                    <button
                      key={id}
                      type="button"
                      role="radio"
                      aria-checked={theme === id}
                      className={`sm-theme-card${theme === id ? ' active' : ''}`}
                      onClick={() => onSelectTheme && onSelectTheme(id)}
                    >
                      <span className={`sm-tp ${id}`}>
                        <span className="sm-tp-side" />
                        <span className="sm-tp-main"><i /><i /><i /></span>
                      </span>
                      <span className="sm-theme-label">
                        <Icon size={16} style={{ color }} />
                        <span>{label}</span>
                      </span>
                      {theme === id && (
                        <span className="sm-theme-tick"><Check size={12} strokeWidth={3} /></span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 2. PROFILE & ACCOUNT */}
            {activeTab === 'profile' && (
              <form onSubmit={handleProfileSubmit} className="sm-form">
                <div className="sm-scroll">
                  <div>
                    <h3 className="sm-section-title">Profile</h3>
                    <p className="sm-section-sub">Manage your name and sign-in credentials.</p>
                  </div>

                  {/* Identity */}
                  <div className="sm-card sm-identity">
                    <div className="sm-avatar">{getInitials(currentUser?.name || name)}</div>
                    <div className="sm-id-text">
                      <div className="sm-id-name">
                        {currentUser?.name || 'Your account'}
                      </div>
                      <div className="sm-id-email">
                        <Mail size={13} style={{ flexShrink: 0 }} />
                        <span>{currentUser?.email || 'N/A'}</span>
                      </div>
                    </div>
                    {roleLabel && <span className="sm-chip">{roleLabel}</span>}
                    <span className="sm-chip" title="Email cannot be changed">
                      <Lock size={12} />
                      <span>Email locked</span>
                    </span>
                  </div>

                  {/* Name */}
                  <div className="sm-field">
                    <label className="sm-label" htmlFor="sm-name">Full name</label>
                    <div className="sm-input-wrap">
                      <User size={16} className="sm-icon" />
                      <input
                        id="sm-name"
                        type="text"
                        className="sm-input"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  {/* Password */}
                  <div className="sm-card sm-card-pad">
                    <div className="sm-pw-head">
                      <div className="sm-pw-title">
                        <KeyRound size={16} />
                        <span>Change password</span>
                      </div>
                      <span className="sm-optional">Optional</span>
                    </div>
                    <p className="sm-hint" style={{ marginBottom: 14 }}>
                      Leave these blank to keep your current password.
                    </p>

                    <div className="sm-stack">
                      <PasswordField
                        id="sm-current"
                        label="Current password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        placeholder="Enter current password"
                        autoComplete="current-password"
                      />
                      <div className="sm-grid-2">
                        <PasswordField
                          id="sm-new"
                          label="New password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="Min. 6 characters"
                          autoComplete="new-password"
                        />
                        <PasswordField
                          id="sm-confirm"
                          label="Confirm password"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          placeholder="Repeat new password"
                          autoComplete="new-password"
                          invalid={mismatch}
                          hint={mismatch ? 'Passwords do not match.' : ''}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Sticky footer */}
                <div className="sm-footer">
                  <div className={`sm-status ${statusMsg.type}`} role="status" aria-live="polite">
                    {statusMsg.text && (
                      <>
                        {statusMsg.type === 'error' ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
                        <span>{statusMsg.text}</span>
                      </>
                    )}
                  </div>
                  <button type="submit" className="sm-btn sm-btn-primary" disabled={!canSave}>
                    {isSaving ? <Loader2 size={16} className="sm-spin" /> : <Check size={16} strokeWidth={2.5} />}
                    <span>{isSaving ? 'Saving…' : 'Save changes'}</span>
                  </button>
                </div>
              </form>
            )}

            {/* 3. DATA CONTROLS */}
            {activeTab === 'data' && (
              <div className="sm-scroll">
                <div>
                  <h3 className="sm-section-title">Data controls</h3>
                  <p className="sm-section-sub">Manage your active conversation.</p>
                </div>

                <div className="sm-card sm-card-pad sm-row">
                  <div className="sm-row-left">
                    <span className="sm-danger-icon"><Trash2 size={18} /></span>
                    <div>
                      <div className="sm-row-title">Delete current chat</div>
                      <div className="sm-row-sub">
                        {hasActiveMessages
                          ? 'Permanently deletes this conversation and all its messages. You will be asked to confirm.'
                          : 'Open a conversation that has messages to delete it.'}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="sm-btn sm-btn-danger"
                    disabled={!hasActiveMessages}
                    onClick={onClearConversation}
                  >
                    <Trash2 size={15} />
                    <span>Delete chat</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}