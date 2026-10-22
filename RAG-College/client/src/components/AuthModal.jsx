import React, { useState, useEffect } from 'react';
import {
  GraduationCap,
  LogIn,
  UserPlus,
  Lock,
  Mail,
  User,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Eye,
  EyeOff,
  Sun,
  Moon,
  X
} from 'lucide-react';

export default function AuthModal({
  isOpen,
  onClose,
  onLogin,
  onRegister,
  isGatekeeper = false,
  theme = 'light',
  onToggleTheme
}) {
  const [tab, setTab] = useState('login'); // 'login' | 'register'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    if (!isOpen) {
      setError('');
      setSuccessMessage('');
      setLoading(false);
      setShowPassword(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (isGatekeeper) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen && !loading && typeof onClose === 'function') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, loading, onClose, isGatekeeper]);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');

    const trimmedEmail = email.trim();
    const trimmedPassword = password;
    const trimmedName = name.trim();

    if (!trimmedEmail || !trimmedPassword) {
      setError('Please fill in both email and password.');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      setError('Please enter a valid email address.');
      return;
    }

    if (tab === 'register') {
      if (!trimmedName) {
        setError('Please provide your full name.');
        return;
      }
      if (trimmedPassword.length < 6) {
        setError('Password must be at least 6 characters long.');
        return;
      }
    }

    setLoading(true);
    try {
      if (tab === 'login') {
        await onLogin({ email: trimmedEmail, password: trimmedPassword });
        if (typeof onClose === 'function') {
          onClose();
        }
      } else {
        await onRegister({ name: trimmedName, email: trimmedEmail, password: trimmedPassword, role: 'user' });
        setSuccessMessage('Account created successfully. Please sign in.');
        setError('');
        setPassword('');
        setEmail('');
        setName('');
        setTab('login');
      }
    } catch (err) {
      setError(err.message || 'Authentication failed. Please check your credentials.');
      setSuccessMessage('');
    } finally {
      setLoading(false);
    }
  };

  const switchTab = (newTab) => {
    setTab(newTab);
    setError('');
    setSuccessMessage('');
  };

  const authCardContent = (
    <div
      className={`auth-card ${isGatekeeper ? 'gatekeeper-card' : 'modal-card'}`}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Modal Close Button (Only shown when used as a popup, never in gatekeeper mode) */}
      {!isGatekeeper && typeof onClose === 'function' && (
        <button
          type="button"
          className="auth-modal-close-btn"
          onClick={onClose}
          disabled={loading}
          title="Close"
          aria-label="Close"
        >
          <X size={16} />
        </button>
      )}

      {/* Card Brand Header */}
      <div className="auth-card-header">
        <div className="auth-brand-badge" title="RAG College">
          <GraduationCap size={24} strokeWidth={2.2} color="#FFFFFF" />
        </div>
        <h1 className="auth-title">
          {tab === 'login' ? 'Welcome to RAG College' : 'Create an Account'}
        </h1>
        <p className="auth-subtitle">
          {tab === 'login'
            ? 'Sign in to access your college syllabus, curriculum documents, and AI assistant.'
            : 'Join RAG College to search academic resources and interact with verified course material.'}
        </p>
      </div>

      {/* Segmented Tab Pill */}
      <div className="auth-segmented-pill" role="tablist" aria-label="Authentication mode">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'login'}
          className={`auth-pill-btn ${tab === 'login' ? 'active' : ''}`}
          onClick={() => switchTab('login')}
          disabled={loading}
        >
          <LogIn size={14} strokeWidth={2.2} />
          <span>Sign In</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'register'}
          className={`auth-pill-btn ${tab === 'register' ? 'active' : ''}`}
          onClick={() => switchTab('register')}
          disabled={loading}
        >
          <UserPlus size={14} strokeWidth={2.2} />
          <span>Create Account</span>
        </button>
      </div>

      {/* Form Area */}
      <form onSubmit={handleSubmit} className="auth-form" noValidate>
        {error && (
          <div className="auth-alert-danger" role="alert">
            <AlertCircle size={15} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        {successMessage && (
          <div className="auth-alert-success" role="status">
            <CheckCircle2 size={15} style={{ flexShrink: 0 }} />
            <span>{successMessage}</span>
          </div>
        )}

        {tab === 'register' && (
          <div className="auth-field">
            <label className="auth-field-label">Full Name</label>
            <div className="auth-field-input-box">
              <User size={15} className="auth-field-icon" />
              <input
                type="text"
                className="auth-field-input"
                placeholder="e.g. Alex Morgan"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (error) setError('');
                  if (successMessage) setSuccessMessage('');
                }}
                disabled={loading}
                autoFocus={tab === 'register'}
                required
              />
            </div>
          </div>
        )}

        <div className="auth-field">
          <label className="auth-field-label">College Email</label>
          <div className="auth-field-input-box">
            <Mail size={15} className="auth-field-icon" />
            <input
              type="email"
              className="auth-field-input"
              placeholder="e.g. student@college.edu"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (error) setError('');
                if (successMessage) setSuccessMessage('');
              }}
              disabled={loading}
              autoFocus={tab === 'login'}
              required
            />
          </div>
        </div>

        <div className="auth-field">
          <div className="auth-field-label-row">
            <label className="auth-field-label">Password</label>
            {tab === 'register' && (
              <span className="auth-field-hint">Min 6 characters</span>
            )}
          </div>
          <div className="auth-field-input-box">
            <Lock size={15} className="auth-field-icon" />
            <input
              type={showPassword ? 'text' : 'password'}
              className="auth-field-input with-action"
              placeholder="••••••••"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) setError('');
                if (successMessage) setSuccessMessage('');
              }}
              disabled={loading}
              required
            />
            <button
              type="button"
              className="auth-password-toggle-btn"
              onClick={() => setShowPassword(!showPassword)}
              tabIndex={-1}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              title={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </div>

        <button
          type="submit"
          className="auth-primary-submit-btn"
          disabled={loading}
        >
          {loading ? (
            <>
              <Loader2 size={16} className="spin" />
              <span>{tab === 'login' ? 'Signing In...' : 'Creating Account...'}</span>
            </>
          ) : (
            <>
              {tab === 'login' ? (
                <LogIn size={15} strokeWidth={2.2} />
              ) : (
                <UserPlus size={15} strokeWidth={2.2} />
              )}
              <span>{tab === 'login' ? 'Sign In to Assistant' : 'Create Account'}</span>
            </>
          )}
        </button>
      </form>

      {/* Switcher Helper Link */}
      <div className="auth-switch-prompt">
        <span>{tab === 'login' ? "Don't have an account?" : 'Already have an account?'}</span>
        <button
          type="button"
          className="auth-switch-link"
          onClick={() => switchTab(tab === 'login' ? 'register' : 'login')}
          disabled={loading}
        >
          {tab === 'login' ? 'Create an account' : 'Sign in'}
        </button>
      </div>

      {/* Footer Academic Security Note */}
      <div className="auth-card-footer">
        <ShieldCheck size={13} className="auth-footer-shield" />
        <span>Authorized Academic Access • RAG College</span>
      </div>
    </div>
  );

  // Dedicated Fullscreen Experience when unauthenticated
  if (isGatekeeper) {
    return (
      <div className="auth-fullscreen-page">
        {/* Top Header Navbar */}
        <header className="auth-fullscreen-header">
          <div className="auth-fullscreen-brand">
            <div className="auth-fullscreen-logo-circle" title="RAG College">
              <GraduationCap size={19} strokeWidth={2.2} color="#FFFFFF" />
            </div>
            <div className="auth-fullscreen-brand-text">
              <span className="auth-fullscreen-brand-name">RAG College</span>
              <span className="auth-fullscreen-brand-tagline">Academic AI Assistant</span>
            </div>
          </div>

          {onToggleTheme && (
            <button
              type="button"
              className="auth-theme-toggle-btn"
              onClick={onToggleTheme}
              title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`}
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? <Sun size={16} strokeWidth={2.2} /> : <Moon size={16} strokeWidth={2.2} />}
            </button>
          )}
        </header>

        {/* Centered Auth Card */}
        <main className="auth-fullscreen-main">
          {authCardContent}
        </main>
      </div>
    );
  }

  // Modal Overlay Variant (e.g. if invoked inside session)
  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!loading && typeof onClose === 'function') onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      {authCardContent}
    </div>
  );
}
