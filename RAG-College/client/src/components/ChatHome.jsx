import React from 'react';
import { GraduationCap } from 'lucide-react';

export default function ChatHome() {
  return (
    <div className="welcome-container">
      <div className="welcome-logo-circle">
        <GraduationCap size={34} strokeWidth={2} color="#FFFFFF" />
      </div>

      <h1 className="welcome-title">Hello!</h1>

      <p className="welcome-subtitle">
        I'm your RAG College assistant. Ask me anything about our college, and I'll help you find the information you need.
      </p>
    </div>
  );
}
