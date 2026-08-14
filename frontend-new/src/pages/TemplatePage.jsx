import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { FileText, Save, Eye, Code } from 'lucide-react';
import api from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner';
import PageHeader from '../components/PageHeader';

export default function TemplatePage() {
  const [activeTab, setActiveTab] = useState('standard');
  const [content, setContent] = useState('');
  const [showPreview, setShowPreview] = useState(false);

  const { data: template, isLoading } = useQuery({
    queryKey: ['template', activeTab],
    queryFn: activeTab === 'standard' ? api.getTemplate : api.getSaasTemplate,
  });

  useEffect(() => {
    if (template?.content) setContent(template.content);
  }, [template]);

  const saveMut = useMutation({
    mutationFn: activeTab === 'standard' ? api.saveTemplate : api.saveSaasTemplate,
    mutationKey: ['saveTemplate', activeTab],
  });

  if (isLoading) return <LoadingSpinner text="Loading template..." />;

  return (
    <div className="fade-in">
      <PageHeader title="Templates" subtitle="Manage email templates for your campaigns.">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowPreview(!showPreview)}
            className="flex items-center gap-2 bg-slate-800 border border-slate-700 text-slate-300 px-3 py-2 rounded-lg text-sm hover:bg-slate-700 transition-colors"
          >
            {showPreview ? <Code size={14} /> : <Eye size={14} />}
            {showPreview ? 'Edit' : 'Preview'}
          </button>
          <button
            onClick={() => saveMut.mutate({ content })}
            disabled={saveMut.isPending}
            className="flex items-center gap-2 bg-accent text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-accent/80 transition-colors disabled:opacity-50"
          >
            <Save size={16} />
            {saveMut.isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </PageHeader>

      <div className="flex items-center gap-1 mb-6 bg-[#111827] border border-slate-800 rounded-lg p-1 w-fit">
        {['standard', 'saas'].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              activeTab === tab ? 'bg-accent text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            {tab === 'standard' ? 'Standard Template' : 'SaaS Template'}
          </button>
        ))}
      </div>

      {saveMut.isSuccess && (
        <div className="mb-4 flex items-center gap-2 text-sm text-success">
          <CheckCircle size={14} />
          Template saved successfully
        </div>
      )}

      <div className="bg-[#111827] border border-slate-800 rounded-xl overflow-hidden">
        {showPreview ? (
          <div className="p-6">
            <div
              className="bg-white rounded-lg p-8 max-w-2xl mx-auto"
              dangerouslySetInnerHTML={{ __html: content }}
            />
          </div>
        ) : (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="w-full h-[500px] bg-transparent text-slate-200 font-mono text-sm p-6 focus:outline-none resize-none"
            placeholder="Enter your email template HTML..."
          />
        )}
      </div>
    </div>
  );
}

function CheckCircle(props) {
  return (
    <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}
