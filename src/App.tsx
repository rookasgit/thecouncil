import React, { useState, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { ROLES, LAB_ROLES, SYNTHESIZER, getActiveAgent, UserSettings, DEFAULT_SETTINGS, CustomAgent } from './agents';
import { TASK_FORCES, TaskForce } from './taskForces';
import { ChatMessage, DeepDive } from './components/ChatMessage';
import { ChatInput, Attachment } from './components/ChatInput';
import { SettingsModal } from './components/SettingsModal';
import { CustomAgentModal } from './components/CustomAgentModal';
import { EditPersonaModal } from './components/EditPersonaModal';
import { TaskForceGrid } from './components/TaskForceGrid';
import { GoogleGenAI, Type } from '@google/genai';
import { getAI, withRetry, calculateQueryCost, fetchLiveContext } from './lib/gemini';
import { extractPartialField, parseAgentResponse, parseSynthesizerResponse } from './lib/streamExtractor';
import { motion, AnimatePresence } from 'motion/react';
import { Trash2, Download, Settings, Menu, Plus, UserPlus, Users, X, Settings2, RefreshCw, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Grid, AlertTriangle } from 'lucide-react';

declare global {
  interface Window {
    aistudio?: {
      openSelectKey: () => Promise<void>;
      hasSelectedApiKey: () => Promise<boolean>;
    };
  }
}

interface FactCheck {
  status: 'verifying' | 'verified' | 'warning' | 'error' | 'interpretation';
  text?: string;
}

interface Message {
  id: string;
  roleId: string;
  text: string;
  isTyping?: boolean;
  deepDives?: DeepDive[];
  attachments?: Attachment[];
  factCheck?: FactCheck;
  isDebate?: boolean;
  synthesizerData?: any;
  fullAnalysis?: string;
  tokenCount?: number;
}

interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  customAgents: CustomAgent[];
  activeAgentIds: string[];
  roleSettings?: UserSettings;
  agentOrder?: string[];
  taskForcePurpose?: string;
  mode?: 'COUNCIL' | 'LAB';
}

const STORAGE_KEY = 'the-council-conversations';
const SETTINGS_KEY = 'the-council-settings';

export default function App() {
  const [appMode, setAppMode] = useState<'COUNCIL' | 'LAB'>('COUNCIL');
  const currentRoles = appMode === 'LAB' ? LAB_ROLES : ROLES;
  
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [isRosterOpen, setIsRosterOpen] = useState(false);
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isCustomAgentModalOpen, setIsCustomAgentModalOpen] = useState(false);
  const [isTaskForceGridOpen, setIsTaskForceGridOpen] = useState(false);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [showQuotaError, setShowQuotaError] = useState(false);
  const [isNewsModeEnabled, setIsNewsModeEnabled] = useState(false);
  const [sessionTokens, setSessionTokens] = useState({ agentInput: 0, agentOutput: 0, synthInput: 0, synthOutput: 0 });
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const currentConv = conversations.find(c => c.id === currentId) || null;
  const messages = currentConv?.messages || [];
  const customAgents = currentConv?.customAgents || [];
  const activeAgentIds = currentConv?.activeAgentIds || currentRoles.map(r => r.id);
  const taskForcePurpose = currentConv?.taskForcePurpose;
  
  const lastMsg = messages[messages.length - 1];
  const showSynthesize = lastMsg && lastMsg.roleId !== 'user' && lastMsg.roleId !== 'synthesizer' && !isProcessing;

  const getAgentGenerationConfig = (baseTemperature: number) => {
    return {
      temperature: appMode === 'LAB' ? 0.2 : baseTemperature,
      ...(appMode === 'LAB' ? { tools: [{ googleSearch: {} }] } : {})
    };
  };

  // Load from local storage on mount
  useEffect(() => {
    const savedMsgs = localStorage.getItem(STORAGE_KEY);
    let initialConvs: Conversation[] = [];
    
    if (savedMsgs) {
      try {
        const parsed = JSON.parse(savedMsgs);
        if (Array.isArray(parsed)) {
          if (parsed.length > 0 && !parsed[0].messages) {
            // Legacy flat messages array
            const migrated = parsed.map((m: any) => {
              if (m.agentId && !m.roleId) {
                let roleId = m.agentId;
                if (m.agentId === 'adam') roleId = 'societal';
                if (m.agentId === 'mark') roleId = 'cultural';
                if (m.agentId === 'brian') roleId = 'creative';
                if (m.agentId === 'jeff') roleId = 'futurist';
                if (m.agentId === 'demis') roleId = 'tech';
                if (m.agentId === 'researcher') roleId = 'researcher';
                return { ...m, roleId };
              }
              return m;
            });
            const newConv: Conversation = {
              id: uuidv4(),
              title: migrated.find((m: any) => m.roleId === 'user')?.text?.substring(0, 30) || 'Legacy Conversation',
              messages: migrated,
              createdAt: Date.now(),
              customAgents: [],
              activeAgentIds: currentRoles.map(r => r.id),
              mode: 'COUNCIL'
            };
            initialConvs = [newConv];
          } else {
            // Already new format
            initialConvs = parsed.map((c: any) => ({
              ...c,
              activeAgentIds: c.activeAgentIds || (c.mode === 'LAB' ? LAB_ROLES : ROLES).map(r => r.id)
            }));
          }
        }
      } catch (e) {
        console.error('Failed to parse saved conversations', e);
      }
    }

    if (initialConvs.length === 0) {
      initialConvs = [{ id: uuidv4(), title: 'New Conversation', messages: [], createdAt: Date.now(), customAgents: [], activeAgentIds: currentRoles.map(r => r.id), roleSettings: DEFAULT_SETTINGS, mode: appMode }];
    }
    
    setConversations(initialConvs);
    setCurrentId(initialConvs[0].id);

    const savedSettings = localStorage.getItem(SETTINGS_KEY);
    if (savedSettings) {
      try {
        setSettings(JSON.parse(savedSettings));
      } catch (e) {
        console.error('Failed to parse saved settings', e);
      }
    }
  }, []);

  // Save conversations to local storage
  useEffect(() => {
    if (conversations.length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
    }
  }, [conversations]);

  // Save settings to local storage
  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  // Auto-scroll - ONLY when user sends a message, not on every update
  useEffect(() => {
    if (messages.length > 0 && messages[messages.length - 1].roleId === 'user') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length]);

  const updateConv = (id: string, updater: (c: Conversation) => Conversation) => {
    setConversations(prev => prev.map(c => c.id === id ? updater(c) : c));
  };

  const createNewConversation = () => {
    const newConv: Conversation = { 
      id: uuidv4(), 
      title: 'New Conversation', 
      messages: [], 
      createdAt: Date.now(), 
      customAgents: [], 
      activeAgentIds: currentRoles.map(r => r.id), 
      roleSettings: settings,
      agentOrder: currentRoles.map(r => r.id),
      mode: appMode
    };
    setConversations(prev => [newConv, ...prev]);
    setCurrentId(newConv.id);
    setIsSidebarOpen(false);
  };

  const toggleAgent = (agentId: string) => {
    if (!currentId) return;
    updateConv(currentId, c => {
      const newActive = c.activeAgentIds.includes(agentId)
        ? c.activeAgentIds.filter(id => id !== agentId)
        : [...c.activeAgentIds, agentId];
      return { ...c, activeAgentIds: newActive };
    });
  };

  const moveAgent = (agentId: string, direction: 'left' | 'right') => {
    if (!currentId || !currentConv) return;
    
    const defaultOrder = [
      ...(currentConv.mode === 'LAB' ? LAB_ROLES : ROLES).map(r => r.id),
      ...currentConv.customAgents.map(a => a.id)
    ];
    
    let currentOrder = currentConv.agentOrder || defaultOrder;
    const missingAgents = defaultOrder.filter(id => !currentOrder.includes(id));
    currentOrder = [...currentOrder, ...missingAgents];
    
    const index = currentOrder.indexOf(agentId);
    if (index === -1) return;
    
    const newIndex = direction === 'left' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= currentOrder.length) return;
    
    const newOrder = [...currentOrder];
    [newOrder[index], newOrder[newIndex]] = [newOrder[newIndex], newOrder[index]];
    
    updateConv(currentId, c => ({ ...c, agentOrder: newOrder }));
  };

  const handleExport = () => {
    if (!currentConv) return;
    
    let md = `# ${currentConv.title}\n\n`;
    md += `*Date: ${new Date(currentConv.createdAt).toLocaleDateString()}*\n`;
    
    const participants = [
      ...(currentConv.mode === 'LAB' ? LAB_ROLES : ROLES).map(r => getActiveAgent(r.id, currentConv.roleSettings || settings, currentConv.mode).name),
      ...currentConv.customAgents.map(a => a.name)
    ];
    md += `*Participants: ${participants.join(', ')}*\n\n---\n\n`;
    
    currentConv.messages.forEach(m => {
      let speaker = 'User';
      if (m.roleId !== 'user') {
        if (m.roleId === 'synthesizer') speaker = 'Synthesizer';
        else {
          const agent = getActiveAgent(m.roleId, currentConv.roleSettings || settings, currentConv.mode);
          if (m.roleId.startsWith('custom-')) {
            const ca = currentConv.customAgents.find(a => a.id === m.roleId);
            if (ca) speaker = ca.name;
          } else {
            speaker = agent.name;
          }
        }
      }
      md += `### ${speaker}\n\n${m.text}\n\n`;
      if (m.deepDives && m.deepDives.length > 0) {
        m.deepDives.forEach(d => {
          md += `> **Deep Dive (${d.keyword})**:\n> ${d.text.split('\n').join('\n> ')}\n\n`;
        });
      }
    });

    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `council-export-${currentConv.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleSuggestExperts = async (topic: string) => {
    if (!topic.trim() || isSuggesting || !currentId) return;
    setIsSuggesting(true);

    try {
      const response = await withRetry(() => getAI().models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `The user wants to discuss: "${topic}". Suggest 2 highly specific, niche, or relevant thinkers/personas to analyze this topic. Provide their name, a system instruction for them to act as this persona (around 100 words), and a hex color code that represents their vibe.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                systemInstruction: { type: Type.STRING },
                color: { type: Type.STRING }
              },
              required: ["name", "systemInstruction", "color"]
            }
          }
        }
      }));

      const suggestions = JSON.parse(response.text || '[]');
      
      updateConv(currentId, c => {
        const newAgents = suggestions.map((s: any) => ({
          id: `custom-${uuidv4()}`,
          thinkerId: `custom-${uuidv4()}`,
          name: s.name,
          color: s.color,
          systemInstruction: s.systemInstruction,
          model: 'gemini-3-flash-preview'
        }));
        
        return {
          ...c,
          customAgents: [...c.customAgents, ...newAgents],
          activeAgentIds: [...c.activeAgentIds, ...newAgents.map((a: any) => a.id)]
        };
      });

    } catch (error: any) {
      console.error("Failed to suggest experts", error);
      if (error?.message?.includes('429') || error?.message?.includes('RESOURCE_EXHAUSTED')) {
        setShowQuotaError(true);
      }
    }
    setIsSuggesting(false);
  };

  const handleSend = async (text: string, attachments: Attachment[] = []) => {
    if ((!text.trim() && attachments.length === 0) || isProcessing || !currentId) return;

    const userMsg: Message = { id: uuidv4(), roleId: 'user', text, attachments };
    
    updateConv(currentId, c => {
      const isFirst = c.messages.length === 0;
      return {
        ...c,
        title: isFirst ? (text.substring(0, 30) || 'Document Analysis') + (text.length > 30 ? '...' : '') : c.title,
        messages: [...c.messages, userMsg]
      };
    });
    
    setIsProcessing(true);

    let liveContext = '';
    if (isNewsModeEnabled && text.trim()) {
      liveContext = await fetchLiveContext(text);
    }

    const latestConv = conversations.find(c => c.id === currentId) || currentConv;
    const activeSettings = latestConv?.roleSettings || settings;

    // Build context from previous messages to allow continuation
    let currentContext = messages.map(m => {
      if (m.roleId === 'user') return `User: ${m.text}`;
      if (m.roleId === 'synthesizer') return `Synthesizer: ${m.text}`;
      
      let agentName = getActiveAgent(m.roleId, activeSettings).name;
      if (m.roleId.startsWith('custom-')) {
        const ca = customAgents.find(a => a.id === m.roleId);
        if (ca) agentName = ca.name;
      }
      // Use full analysis if available for deeper context
      return `${agentName}: ${m.fullAnalysis || m.text}`;
    }).join('\n\n');
    
    currentContext += `\n\nUser asked: ${text}\n\n`;
    
    const defaultOrder = [
      ...ROLES.map(r => r.id),
      ...(latestConv?.customAgents || []).map(a => a.id)
    ];
    let order = latestConv?.agentOrder || defaultOrder;
    const missing = defaultOrder.filter(id => !order.includes(id));
    order = [...order, ...missing];

    const allAvailableAgents = [
      ...ROLES.map(r => getActiveAgent(r.id, activeSettings)),
      ...(latestConv?.customAgents || [])
    ];
    
    // Only run agents that are currently active and sort them
    const agentsToRun = allAvailableAgents
      .filter(a => latestConv?.activeAgentIds.includes(a.id))
      .sort((a, b) => {
        const orderA = order.indexOf(a.id);
        const orderB = order.indexOf(b.id);
        return (orderA === -1 ? 999 : orderA) - (orderB === -1 ? 999 : orderB);
      });
    
    // Add all empty messages to state first
    const agentMessages = agentsToRun.map(agent => ({
      id: uuidv4(),
      roleId: agent.id,
      text: '',
      isTyping: true
    }));

    updateConv(currentId, c => ({
      ...c,
      messages: [...c.messages, ...agentMessages]
    }));

    // Start all generations concurrently
    await Promise.all(agentsToRun.map(async (agent, index) => {
      const agentMsgId = agentMessages[index].id;
      
      try {
        let effectiveUserPrompt = text;
        if (liveContext) {
          effectiveUserPrompt = `CURRENT GLOBAL CONTEXT: \n${liveContext}\n\nUSER PROMPT: ${text}`;
        }
        const prompt = `Topic: ${effectiveUserPrompt}\n\nPrevious thoughts from the council:\n${currentContext}\n\nNow, provide your perspective based on your system instructions.`;
        
        const parts: any[] = [];
        if (attachments && attachments.length > 0) {
          attachments.forEach(att => {
            parts.push({
              inlineData: {
                mimeType: att.mimeType,
                data: att.data
              }
            });
          });
        }
        parts.push({ text: prompt });

        const modelName = agent.model || 'gemini-3-flash-preview';
        const payload = {
          contents: { parts },
          config: {
            systemInstruction: agent.systemInstruction + "\n\nCRITICAL SYSTEM DIRECTIVE: You must output a valid JSON object with EXACTLY two keys: 'provocation' (a short quote under 250 chars) and 'full_analysis' (a deep multi-paragraph breakdown). Do not include markdown blocks.",
            ...getAgentGenerationConfig(0.7),
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                full_analysis: {
                  type: Type.STRING,
                  description: "A deep, multi-paragraph analysis from the persona's worldview."
                },
                provocation: {
                  type: Type.STRING,
                  description: "A single, punchy, provocative sentence summarizing the core insight."
                }
              },
              required: ["full_analysis", "provocation"]
            }
          },
        };

        const responseStream = await withRetry(() => getAI().models.generateContentStream({
          model: modelName,
          ...payload
        }));

        let fullText = '';
        let inputTokens = 0;
        let outputTokens = 0;

        for await (const chunk of responseStream) {
          if (chunk.text) {
            fullText += chunk.text;
            
            // Real-time extraction for progressive typing
            const partialProvocation = extractPartialField(fullText, 'provocation');
            const partialAnalysis = extractPartialField(fullText, 'full_analysis');
            const hasJsonFields = !!partialProvocation || fullText.includes('"provocation"');

            updateConv(currentId, c => ({
              ...c,
              messages: c.messages.map(msg => 
                msg.id === agentMsgId ? { 
                  ...msg, 
                  text: hasJsonFields ? (partialProvocation || "...") : fullText,
                  fullAnalysis: partialAnalysis
                } : msg
              )
            }));
          }
          
          if (chunk.usageMetadata) {
            inputTokens = chunk.usageMetadata.promptTokenCount || 0;
            outputTokens = chunk.usageMetadata.candidatesTokenCount || 0;
          }
        }
        
        setSessionTokens(prev => ({
          ...prev,
          agentInput: prev.agentInput + inputTokens,
          agentOutput: prev.agentOutput + outputTokens
        }));
        
        const { provocation, fullAnalysis } = parseAgentResponse(fullText);

        updateConv(currentId, c => ({
          ...c,
          messages: c.messages.map(msg => 
            msg.id === agentMsgId ? { ...msg, isTyping: false, text: provocation, fullAnalysis } : msg
          )
        }));
        
      } catch (error: any) {
        console.error(`Error with ${agent.name}:`, error);
        if (error?.message?.includes('429') || error?.message?.includes('RESOURCE_EXHAUSTED')) {
          setShowQuotaError(true);
        }
        updateConv(currentId, c => ({
          ...c,
          messages: c.messages.map(msg => 
            msg.id === agentMsgId ? { ...msg, text: '[Connection lost]', isTyping: false } : msg
          )
        }));
      }
    }));

    setIsProcessing(false);
  };



  const handleRetry = async (messageId: string) => {
    if (!currentId || isProcessing) return;
    
    const targetMsg = messages.find(m => m.id === messageId);
    if (!targetMsg) return;

    // Determine if it's a synthesizer message or a regular agent message
    if (targetMsg.roleId === 'synthesizer') {
      // Retry synthesis
      setIsProcessing(true);
      
      // Reset message state
      updateConv(currentId, c => ({
        ...c,
        messages: c.messages.map(msg => 
          msg.id === messageId ? { ...msg, text: '', isTyping: true, factCheck: undefined } : msg
        )
      }));

      try {
        const lastUserIndex = [...messages].reverse().findIndex(m => m.roleId === 'user');
        // We need to exclude the failed synth message itself from context
        const relevantMessages = (lastUserIndex !== -1 ? messages.slice(messages.length - 1 - lastUserIndex) : messages)
          .filter(m => m.id !== messageId);
        
        const context = relevantMessages.map(m => {
          let agentName = getActiveAgent(m.roleId, currentConv?.roleSettings || settings).name;
          if (m.roleId.startsWith('custom-')) {
            const ca = customAgents.find(a => a.id === m.roleId);
            if (ca) agentName = ca.name;
          }
          return `${agentName}: ${m.fullAnalysis || m.text}`;
        }).join('\n\n');
        
        let prompt = `Synthesize the following discussion:\n\n${context}`;
        
        if (taskForcePurpose) {
          prompt = `You are moderating a curated panel. The specific goal of this session is: ${taskForcePurpose}. When you generate your final 3 provocative questions, they MUST NOT be generic. They must be aggressively tailored to help the user achieve this specific goal using the friction you just observed between the agents.\n\n${prompt}`;
        }

        const activeSynth = getActiveAgent('synthesizer', currentConv?.roleSettings || settings);
        
        const responseStream = await withRetry(() => getAI().models.generateContentStream({
          model: activeSynth.model || 'gemini-3.1-pro-preview',
          contents: prompt,
          config: {
            systemInstruction: activeSynth.systemInstruction,
            temperature: 0.5,
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                echarts_heatmap: {
                  type: Type.OBJECT,
                  description: "A valid Apache ECharts JSON configuration for a heatmap series."
                },
                alignment_quotes: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      agents: { type: Type.ARRAY, items: { type: Type.STRING } },
                      type: { type: Type.STRING, enum: ["friction", "consensus"] },
                      quote: { type: Type.STRING }
                    },
                    required: ["agents", "type", "quote"]
                  }
                },
                fact_check: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      agent: { type: Type.STRING },
                      claim: { type: Type.STRING },
                      verdict: { type: Type.STRING, enum: ["VERIFIED", "DEBUNKED", "NEEDS CONTEXT"] },
                      context: { type: Type.STRING }
                    },
                    required: ["agent", "claim", "verdict", "context"]
                  }
                },
                whitepaper_markdown: { type: Type.STRING }
              },
              required: ["echarts_heatmap", "alignment_quotes", "fact_check", "whitepaper_markdown"]
            },
            tools: [{ googleSearch: {} }]
          },
        }));

        let fullText = '';
        for await (const chunk of responseStream) {
          if (chunk.text) {
            fullText += chunk.text;
            updateConv(currentId, c => ({
              ...c,
              messages: c.messages.map(msg => 
                msg.id === messageId ? { ...msg, text: fullText } : msg
              )
            }));
          }
        }
        
        const synthesizerData = parseSynthesizerResponse(fullText);
        
        updateConv(currentId, c => ({
          ...c,
          messages: c.messages.map(msg => 
            msg.id === messageId ? { ...msg, isTyping: false, synthesizerData, factCheck: { status: 'verifying' } } : msg
          )
        }));

        // Re-run Fact Check
        try {
          const factCheckResponse = await withRetry(() => getAI().models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: `You are a rigorous fact-checker for a debate between AI personas (e.g., Baudrillard, Zizek, etc.).
            Your goal is to distinguish between **Objective Factual Errors** and **Persona Interpretations**.

            Text to check:
            "${fullText}"

            Analyze the text.
            1. **Objective Factual Errors**: Wrong dates, wrong historical events, scientific falsehoods presented as consensus fact. (e.g. "World War II ended in 1950").
            2. **Persona Interpretations**: Philosophical claims, theoretical frameworks, or subjective viewpoints that are consistent with the persona but not "objective fact". (e.g. "Reality is a simulation").

            Output Format:
            If there are **Objective Factual Errors**, return exactly:
            STATUS: ERROR
            [List of specific factual corrections]

            If there are **No Factual Errors** but significant **Persona Interpretations** that might be mistaken for fact, return exactly:
            STATUS: INTERPRETATION
            [List of claims that are theoretical interpretations, not objective facts]

            If the text is purely factual and accurate (or correctly attributes interpretations), return exactly:
            STATUS: VERIFIED`,
          }));

          const factCheckText = factCheckResponse.text?.trim() || '';
          
          let status: FactCheck['status'] = 'warning';
          let displayText: string | undefined = factCheckText;

          if (factCheckText.includes('STATUS: VERIFIED')) {
            status = 'verified';
            displayText = undefined;
          } else if (factCheckText.includes('STATUS: INTERPRETATION')) {
            status = 'interpretation';
            displayText = factCheckText.replace('STATUS: INTERPRETATION', '').trim();
          } else if (factCheckText.includes('STATUS: ERROR')) {
            status = 'warning';
            displayText = factCheckText.replace('STATUS: ERROR', '').trim();
          }

          updateConv(currentId, c => ({
            ...c,
            messages: c.messages.map(msg => 
              msg.id === messageId ? { 
                ...msg, 
                factCheck: { 
                  status,
                  text: displayText
                } 
              } : msg
            )
          }));
        } catch (fcError) {
          console.error('Fact check failed:', fcError);
          updateConv(currentId, c => ({
            ...c,
            messages: c.messages.map(msg => 
              msg.id === messageId ? { ...msg, factCheck: { status: 'error', text: 'Fact check failed' } } : msg
            )
          }));
        }

      } catch (error: any) {
        console.error('Error retrying synthesis:', error);
        if (error?.message?.includes('429') || error?.message?.includes('RESOURCE_EXHAUSTED')) {
          setShowQuotaError(true);
        }
        updateConv(currentId, c => ({
          ...c,
          messages: c.messages.map(msg => 
            msg.id === messageId ? { ...msg, text: '[Synthesis failed]', isTyping: false } : msg
          )
        }));
      }
      setIsProcessing(false);

    } else {
      // Retry regular agent
      setIsProcessing(true);
      
      // Reset message state
      updateConv(currentId, c => ({
        ...c,
        messages: c.messages.map(msg => 
          msg.id === messageId ? { ...msg, text: '', isTyping: true } : msg
        )
      }));

      try {
        const agent = getActiveAgent(targetMsg.roleId, currentConv?.roleSettings || settings);
        if (targetMsg.roleId.startsWith('custom-')) {
          const ca = customAgents.find(a => a.id === targetMsg.roleId);
          if (ca) Object.assign(agent, ca);
        }

        // Reconstruct context
        // Find the user message that triggered this batch
        // We assume the batch is bounded by user messages
        const msgIndex = messages.findIndex(m => m.id === messageId);
        const previousMessages = messages.slice(0, msgIndex);
        const lastUserMsg = [...previousMessages].reverse().find(m => m.roleId === 'user');
        
        if (!lastUserMsg) {
          throw new Error('Could not find original user prompt');
        }

        // Construct context from history up to the user message
        const contextMessages = previousMessages.filter(m => m.id !== lastUserMsg.id); // Everything before the prompt
        const currentContext = contextMessages.map(m => {
          let agentName = getActiveAgent(m.roleId, currentConv?.roleSettings || settings).name;
          if (m.roleId.startsWith('custom-')) {
            const ca = customAgents.find(a => a.id === m.roleId);
            if (ca) agentName = ca.name;
          }
          return `${agentName}: ${m.fullAnalysis || m.text}`;
        }).join('\n\n');

        const prompt = `Topic: ${lastUserMsg.text}\n\nPrevious thoughts from the council:\n${currentContext}\n\nNow, provide your perspective on the topic, maintaining your persona and reacting to the previous thoughts if relevant.`;

        const responseStream = await withRetry(() => getAI().models.generateContentStream({
          model: agent.model || 'gemini-3-flash-preview',
          contents: prompt,
          config: {
            systemInstruction: agent.systemInstruction + "\n\nCRITICAL SYSTEM DIRECTIVE: You must output a valid JSON object with EXACTLY two keys: 'provocation' (a short quote under 250 chars) and 'full_analysis' (a deep multi-paragraph breakdown). Do not include markdown blocks.",
            ...getAgentGenerationConfig(0.7),
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                full_analysis: {
                  type: Type.STRING,
                  description: "A deep, multi-paragraph analysis from the persona's worldview."
                },
                provocation: {
                  type: Type.STRING,
                  description: "A single, punchy, provocative sentence summarizing the core insight."
                }
              },
              required: ["full_analysis", "provocation"]
            }
          },
        }));

        let fullText = '';
        for await (const chunk of responseStream) {
          if (chunk.text) {
            fullText += chunk.text;
            
            // Real-time extraction for progressive typing
            const partialProvocation = extractPartialField(fullText, 'provocation');
            const partialAnalysis = extractPartialField(fullText, 'full_analysis');
            const hasJsonFields = !!partialProvocation || fullText.includes('"provocation"');

            updateConv(currentId, c => ({
              ...c,
              messages: c.messages.map(msg => 
                msg.id === messageId ? { 
                  ...msg, 
                  text: hasJsonFields ? (partialProvocation || "...") : fullText,
                  fullAnalysis: partialAnalysis
                } : msg
              )
            }));
          }
        }
        
        const { provocation, fullAnalysis } = parseAgentResponse(fullText);

        updateConv(currentId, c => ({
          ...c,
          messages: c.messages.map(msg => 
            msg.id === messageId ? { ...msg, isTyping: false, text: provocation, fullAnalysis } : msg
          )
        }));

      } catch (error: any) {
        console.error('Error retrying agent:', error);
        if (error?.message?.includes('429') || error?.message?.includes('RESOURCE_EXHAUSTED')) {
          setShowQuotaError(true);
        }
        updateConv(currentId, c => ({
          ...c,
          messages: c.messages.map(msg => 
            msg.id === messageId ? { ...msg, text: '[Connection lost]', isTyping: false } : msg
          )
        }));
      }
      setIsProcessing(false);
    }
  };

  const handleRegenerateWithFactCheck = async (messageId: string) => {
    if (!currentId || isProcessing) return;
    
    const targetMsg = messages.find(m => m.id === messageId);
    if (!targetMsg || targetMsg.roleId !== 'synthesizer' || !targetMsg.factCheck?.text) return;

    setIsProcessing(true);
    
    // Store fact check feedback before clearing message
    const factCheckFeedback = targetMsg.factCheck.text;

    // Reset message state
    updateConv(currentId, c => ({
      ...c,
      messages: c.messages.map(msg => 
        msg.id === messageId ? { ...msg, text: '', isTyping: true, factCheck: { status: 'verifying' } } : msg
      )
    }));

    try {
      const lastUserIndex = [...messages].reverse().findIndex(m => m.roleId === 'user');
      const relevantMessages = (lastUserIndex !== -1 ? messages.slice(messages.length - 1 - lastUserIndex) : messages)
        .filter(m => m.id !== messageId);
      
      const context = relevantMessages.map(m => {
        let agentName = getActiveAgent(m.roleId, currentConv?.roleSettings || settings).name;
        if (m.roleId.startsWith('custom-')) {
          const ca = customAgents.find(a => a.id === m.roleId);
          if (ca) agentName = ca.name;
        }
        return `${agentName}: ${m.fullAnalysis || m.text}`;
      }).join('\n\n');
      
      let prompt = `Synthesize the following discussion:\n\n${context}\n\nIMPORTANT: The previous synthesis contained the following factual inaccuracies which MUST be corrected in this new version:\n${factCheckFeedback}\n\nEnsure the new synthesis is factually accurate and addresses these points.`;
      
      if (taskForcePurpose) {
        prompt = `You are moderating a curated panel. The specific goal of this session is: ${taskForcePurpose}. When you generate your final 3 provocative questions, they MUST NOT be generic. They must be aggressively tailored to help the user achieve this specific goal using the friction you just observed between the agents.\n\n${prompt}`;
      }

      const activeSynth = getActiveAgent('synthesizer', currentConv?.roleSettings || settings);
      
      const responseStream = await withRetry(() => getAI().models.generateContentStream({
        model: activeSynth.model || 'gemini-3.1-pro-preview',
        contents: prompt,
        config: {
          systemInstruction: activeSynth.systemInstruction,
          temperature: 0.5,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              echarts_heatmap: {
                type: Type.OBJECT,
                description: "A valid Apache ECharts JSON configuration for a heatmap series."
              },
              alignment_quotes: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    agents: { type: Type.ARRAY, items: { type: Type.STRING } },
                    type: { type: Type.STRING, enum: ["friction", "consensus"] },
                    quote: { type: Type.STRING }
                  },
                  required: ["agents", "type", "quote"]
                }
              },
              fact_check: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    agent: { type: Type.STRING },
                    claim: { type: Type.STRING },
                    verdict: { type: Type.STRING, enum: ["VERIFIED", "DEBUNKED", "NEEDS CONTEXT"] },
                    context: { type: Type.STRING }
                  },
                  required: ["agent", "claim", "verdict", "context"]
                }
              },
              whitepaper_markdown: { type: Type.STRING }
            },
            required: ["echarts_heatmap", "alignment_quotes", "fact_check", "whitepaper_markdown"]
          },
          tools: [{ googleSearch: {} }]
        },
      }));

      let fullText = '';
      for await (const chunk of responseStream) {
        if (chunk.text) {
          fullText += chunk.text;
          updateConv(currentId, c => ({
            ...c,
            messages: c.messages.map(msg => 
              msg.id === messageId ? { ...msg, text: fullText } : msg
            )
          }));
        }
      }
      
      const synthesizerData = parseSynthesizerResponse(fullText);
      
      updateConv(currentId, c => ({
        ...c,
        messages: c.messages.map(msg => 
          msg.id === messageId ? { ...msg, isTyping: false, synthesizerData } : msg
        )
      }));

      // Re-run Fact Check
      try {
        const factCheckResponse = await withRetry(() => getAI().models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: `You are a rigorous fact-checker for a debate between AI personas (e.g., Baudrillard, Zizek, etc.).
          Your goal is to distinguish between **Objective Factual Errors** and **Persona Interpretations**.

          Text to check:
          "${fullText}"

          Analyze the text.
          1. **Objective Factual Errors**: Wrong dates, wrong historical events, scientific falsehoods presented as consensus fact. (e.g. "World War II ended in 1950").
          2. **Persona Interpretations**: Philosophical claims, theoretical frameworks, or subjective viewpoints that are consistent with the persona but not "objective fact". (e.g. "Reality is a simulation").

          Output Format:
          If there are **Objective Factual Errors**, return exactly:
          STATUS: ERROR
          [List of specific factual corrections]

          If there are **No Factual Errors** but significant **Persona Interpretations** that might be mistaken for fact, return exactly:
          STATUS: INTERPRETATION
          [List of claims that are theoretical interpretations, not objective facts]

          If the text is purely factual and accurate (or correctly attributes interpretations), return exactly:
          STATUS: VERIFIED`,
        }));

        const factCheckText = factCheckResponse.text?.trim() || '';
        
        let status: FactCheck['status'] = 'warning';
        let displayText: string | undefined = factCheckText;

        if (factCheckText.includes('STATUS: VERIFIED')) {
          status = 'verified';
          displayText = undefined;
        } else if (factCheckText.includes('STATUS: INTERPRETATION')) {
          status = 'interpretation';
          displayText = factCheckText.replace('STATUS: INTERPRETATION', '').trim();
        } else if (factCheckText.includes('STATUS: ERROR')) {
          status = 'warning';
          displayText = factCheckText.replace('STATUS: ERROR', '').trim();
        }

        updateConv(currentId, c => ({
          ...c,
          messages: c.messages.map(msg => 
            msg.id === messageId ? { 
              ...msg, 
              factCheck: { 
                status,
                text: displayText
              } 
            } : msg
          )
        }));
      } catch (fcError: any) {
        console.error('Fact check failed:', fcError);
        if (fcError?.message?.includes('429') || fcError?.message?.includes('RESOURCE_EXHAUSTED')) {
          setShowQuotaError(true);
        }
        updateConv(currentId, c => ({
          ...c,
          messages: c.messages.map(msg => 
            msg.id === messageId ? { ...msg, factCheck: { status: 'error', text: 'Fact check failed' } } : msg
          )
        }));
      }

    } catch (error: any) {
      console.error('Error regenerating synthesis:', error);
      if (error?.message?.includes('429') || error?.message?.includes('RESOURCE_EXHAUSTED')) {
        setShowQuotaError(true);
      }
      updateConv(currentId, c => ({
        ...c,
        messages: c.messages.map(msg => 
          msg.id === messageId ? { ...msg, text: '[Synthesis failed]', isTyping: false } : msg
        )
      }));
    }
    setIsProcessing(false);
  };

  const handleParameterChange = async (messageId: string, newValue: number) => {
    if (!currentId) return;
    
    const targetMsg = messages.find(m => m.id === messageId);
    if (!targetMsg) return;

    // Update local settings state first for immediate UI feedback
    const roleId = targetMsg.roleId;
    const newSettings = {
      ...(currentConv?.roleSettings || settings),
      [roleId]: {
        ...(currentConv?.roleSettings?.[roleId] || settings[roleId] || DEFAULT_SETTINGS[roleId]),
        parameterValue: newValue
      }
    };
    
    setSettings(newSettings);
    updateConv(currentId, c => ({ ...c, roleSettings: newSettings }));
    
    // Store original text before clearing
    const originalResponse = targetMsg.text;

    // Reset message state
    updateConv(currentId, c => ({
      ...c,
      messages: c.messages.map(msg => 
        msg.id === messageId ? { ...msg, text: '', isTyping: true, factCheck: undefined } : msg
      )
    }));

    try {
      const agent = getActiveAgent(roleId, newSettings);
      let parameterName = 'Intensity';
      if (roleId === 'synthesizer') parameterName = 'Synthesis Depth';
      else if (!roleId.startsWith('custom-')) {
        const role = ROLES.find(r => r.id === roleId);
        if (role?.parameter) parameterName = role.parameter.name;
      }

      const prompt = `You are ${agent.name}.

You previously generated a response to the conversation.
Your Previous Response: "${originalResponse}"

The user has just adjusted your ${parameterName} parameter to ${newValue} out of 100.

Rewrite your response. You MUST maintain your exact core argument, analytical framework, and final conclusion. However, you must drastically shift your rhetorical style, tone, and vocabulary to reflect this new parameter value. Stay completely in character. Do not acknowledge this adjustment to the user; just deliver the modified response.`;

      const responseStream = await withRetry(() => getAI().models.generateContentStream({
        model: agent.model || 'gemini-3-flash-preview',
        contents: prompt,
        config: {
          systemInstruction: agent.systemInstruction + "\n\nCRITICAL SYSTEM DIRECTIVE: You must output a valid JSON object with EXACTLY two keys: 'provocation' (a short quote under 250 chars) and 'full_analysis' (a deep multi-paragraph breakdown). Do not include markdown blocks.",
          ...getAgentGenerationConfig(0.7),
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              full_analysis: {
                type: Type.STRING,
                description: "A deep, multi-paragraph analysis from the persona's worldview."
              },
              provocation: {
                type: Type.STRING,
                description: "A single, punchy, provocative sentence summarizing the core insight."
              }
            },
            required: ["full_analysis", "provocation"]
          }
        },
      }));

      let fullText = '';
      for await (const chunk of responseStream) {
        if (chunk.text) {
          fullText += chunk.text;
          
          const partialProvocation = extractPartialField(fullText, 'provocation');
          const partialAnalysis = extractPartialField(fullText, 'full_analysis');
          const hasJsonFields = !!partialProvocation || fullText.includes('"provocation"');

          updateConv(currentId, c => ({
            ...c,
            messages: c.messages.map(msg => 
              msg.id === messageId ? { 
                ...msg, 
                text: hasJsonFields ? (partialProvocation || "...") : fullText,
                fullAnalysis: partialAnalysis
              } : msg
            )
          }));
        }
      }
      
      if (!fullText) {
        throw new Error('No response generated');
      }

      const { provocation, fullAnalysis } = parseAgentResponse(fullText);

      updateConv(currentId, c => ({
        ...c,
        messages: c.messages.map(msg => 
          msg.id === messageId ? { 
            ...msg, 
            text: provocation || fullText,
            fullAnalysis: fullAnalysis,
            isTyping: false 
          } : msg
        )
      }));

    } catch (error: any) {
      console.error('Error updating parameter response:', error);
      if (error?.message?.includes('429') || error?.message?.includes('RESOURCE_EXHAUSTED')) {
        setShowQuotaError(true);
      }
      updateConv(currentId, c => ({
        ...c,
        messages: c.messages.map(msg => 
          msg.id === messageId ? { ...msg, text: originalResponse || '[Connection lost]', isTyping: false } : msg
        )
      }));
    }
  };

  const handleFactCheck = async (messageId: string, textToCheck: string, context: string[]) => {
    if (!currentId) return;

    updateConv(currentId, c => ({
      ...c,
      messages: c.messages.map(msg => 
        msg.id === messageId ? { ...msg, factCheck: { status: 'verifying' } } : msg
      )
    }));

    try {
      const factCheckResponse = await withRetry(() => getAI().models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `You are a rigorous fact-checker for a debate between AI personas.
        Your goal is to distinguish between **Objective Factual Errors** and **Persona Interpretations**.

        Context (Previous Arguments):
        ${context.join('\n\n')}

        Text to Check (Synthesis/Conclusion):
        "${textToCheck}"

        Analyze the text.
        1. **Objective Factual Errors**: Wrong dates, wrong historical events, scientific falsehoods presented as consensus fact.
        2. **Persona Interpretations**: Philosophical claims, theoretical frameworks, or subjective viewpoints that are consistent with the persona but not "objective fact".

        Output Format:
        If there are **Objective Factual Errors**, return exactly:
        STATUS: ERROR
        [List of specific factual corrections]

        If there are **No Factual Errors** but significant **Persona Interpretations** that might be mistaken for fact, return exactly:
        STATUS: INTERPRETATION
        [List of claims that are theoretical interpretations, not objective facts]

        If the text is purely factual and accurate (or correctly attributes interpretations), return exactly:
        STATUS: VERIFIED`,
      }));

      const factCheckText = factCheckResponse.text?.trim() || '';
      
      let status: FactCheck['status'] = 'warning';
      let displayText: string | undefined = factCheckText;

      if (factCheckText.includes('STATUS: VERIFIED')) {
        status = 'verified';
        displayText = undefined;
      } else if (factCheckText.includes('STATUS: INTERPRETATION')) {
        status = 'interpretation';
        displayText = factCheckText.replace('STATUS: INTERPRETATION', '').trim();
      } else if (factCheckText.includes('STATUS: ERROR')) {
        status = 'warning'; // Keep as warning for errors to show alert icon
        displayText = factCheckText.replace('STATUS: ERROR', '').trim();
      }

      updateConv(currentId, c => ({
        ...c,
        messages: c.messages.map(msg => 
          msg.id === messageId ? { 
            ...msg, 
            factCheck: { 
              status,
              text: displayText
            } 
          } : msg
        )
      }));
    } catch (fcError: any) {
      console.error('Fact check failed:', fcError);
      if (fcError?.message?.includes('429') || fcError?.message?.includes('RESOURCE_EXHAUSTED')) {
        setShowQuotaError(true);
      }
      updateConv(currentId, c => ({
        ...c,
        messages: c.messages.map(msg => 
          msg.id === messageId ? { ...msg, factCheck: { status: 'error', text: 'Fact check failed' } } : msg
        )
      }));
    }
  };

  const handleDeepDive = async (messageId: string, keyword: string) => {
    if (!currentId) return;
    const parentMsg = messages.find(m => m.id === messageId);
    if (!parentMsg) return;

    let activeAgent = getActiveAgent(parentMsg.roleId, currentConv?.roleSettings || settings);
    if (parentMsg.roleId.startsWith('custom-')) {
      const ca = customAgents.find(a => a.id === parentMsg.roleId);
      if (ca) activeAgent = ca;
    }
    
    const deepDiveId = uuidv4();

    updateConv(currentId, c => ({
      ...c,
      messages: c.messages.map(msg => {
        if (msg.id === messageId) {
          return {
            ...msg,
            deepDives: [...(msg.deepDives || []), { id: deepDiveId, keyword, text: '', isTyping: true }]
          };
        }
        return msg;
      })
    }));

    try {
      const prompt = `You previously said: "${parentMsg.text}"\n\nThe user wants you to elaborate specifically on the concept of: "${keyword}". Provide a focused, deeper analysis of this specific point, maintaining your persona. Keep it concise, around 100 words.`;
      
      const responseStream = await withRetry(() => getAI().models.generateContentStream({
        model: activeAgent.model || 'gemini-3-flash-preview',
        contents: prompt,
        config: {
          systemInstruction: activeAgent.systemInstruction + "\n\nCRITICAL SYSTEM DIRECTIVE: You must output a valid JSON object with EXACTLY two keys: 'provocation' (a short quote under 250 chars) and 'full_analysis' (a deep multi-paragraph breakdown). Do not include markdown blocks.",
          temperature: 0.7,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              full_analysis: {
                type: Type.STRING,
                description: "A deep, multi-paragraph analysis from the persona's worldview."
              },
              provocation: {
                type: Type.STRING,
                description: "A single, punchy, provocative sentence summarizing the core insight."
              }
            },
            required: ["full_analysis", "provocation"]
          }
        },
      }));

      let fullText = '';
      for await (const chunk of responseStream) {
        if (chunk.text) {
          fullText += chunk.text;
          
          // Real-time extraction for progressive typing
          const partialProvocation = extractPartialField(fullText, 'provocation');
          const partialAnalysis = extractPartialField(fullText, 'full_analysis');
          const hasJsonFields = !!partialProvocation || fullText.includes('"provocation"');

          updateConv(currentId, c => ({
            ...c,
            messages: c.messages.map(msg => {
              if (msg.id === messageId) {
                return {
                  ...msg,
                  deepDives: msg.deepDives?.map(dd => 
                    dd.id === deepDiveId ? { 
                      ...dd, 
                      text: hasJsonFields ? (partialProvocation || "...") : fullText,
                      fullAnalysis: partialAnalysis
                    } : dd
                  )
                };
              }
              return msg;
            })
          }));
        }
      }

      const { provocation, fullAnalysis } = parseAgentResponse(fullText);

      updateConv(currentId, c => ({
        ...c,
        messages: c.messages.map(msg => {
          if (msg.id === messageId) {
            return {
              ...msg,
              deepDives: msg.deepDives?.map(dd => 
                dd.id === deepDiveId ? { ...dd, isTyping: false, text: provocation, fullAnalysis } : dd
              )
            };
          }
          return msg;
        })
      }));

    } catch (error: any) {
      console.error('Error in deep dive:', error);
      if (error?.message?.includes('429') || error?.message?.includes('RESOURCE_EXHAUSTED')) {
        setShowQuotaError(true);
      }
      updateConv(currentId, c => ({
        ...c,
        messages: c.messages.map(msg => {
          if (msg.id === messageId) {
            return {
              ...msg,
              deepDives: msg.deepDives?.map(dd => 
                dd.id === deepDiveId ? { ...dd, text: '[Deep dive failed]', isTyping: false } : dd
              )
            };
          }
          return msg;
        })
      }));
    }
  };

  const handleSynthesize = async () => {
    if (!currentId || isProcessing) return;
    
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.roleId === 'synthesizer') return;

    // Find the current group of messages
    let groupStart = messages.length - 1;
    while (groupStart >= 0 && messages[groupStart].roleId !== 'user') {
      groupStart--;
    }
    const userMsg = messages[groupStart];
    const agentMsgs = messages.slice(groupStart + 1);
    
    if (!userMsg || agentMsgs.length === 0) return;

    setIsProcessing(true);
    const synthId = uuidv4();
    
    updateConv(currentId, c => ({
      ...c,
      messages: [...c.messages, { id: synthId, roleId: 'synthesizer', text: '', isTyping: true }]
    }));

    try {
      const synthAgent = getActiveAgent('synthesizer', activeSettings);
      const context = agentMsgs.map(m => {
        const agent = getActiveAgent(m.roleId, activeSettings);
        let agentName = agent.name;
        if (m.roleId.startsWith('custom-')) {
          const ca = customAgents.find(a => a.id === m.roleId);
          if (ca) agentName = ca.name;
        }
        return `${agentName}: ${m.text}`;
      }).join('\n\n');

      // -----------------------------------------------------------------------
      // STEP 1: Standalone Fact Checker (Linear Pipeline)
      // -----------------------------------------------------------------------
      let factCheckerResults: any[] = [];
      try {
        const factCheckResponse = await withRetry(() => getAI().models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: `You are a rigorous fact-checker for a debate between AI personas.
          Your goal is to distinguish between **Objective Factual Errors** and **Persona Interpretations**.

          Context (Previous Arguments):
          ${context}

          Analyze the text for objective factual errors (wrong dates, wrong historical events, scientific falsehoods).
          Ignore philosophical interpretations.

          Output a JSON array of objects with this schema:
          [{ "agent": "Name", "claim": "The claim made", "verdict": "VERIFIED" | "DEBUNKED" | "NEEDS CONTEXT", "context": "Correction or context" }]
          
          If no errors are found, return an empty array [].`,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  agent: { type: Type.STRING },
                  claim: { type: Type.STRING },
                  verdict: { type: Type.STRING, enum: ["VERIFIED", "DEBUNKED", "NEEDS CONTEXT"] },
                  context: { type: Type.STRING }
                },
                required: ["agent", "claim", "verdict", "context"]
              }
            },
            tools: [{ googleSearch: {} }]
          }
        }));
        
        factCheckerResults = JSON.parse(factCheckResponse.text || '[]');
      } catch (fcError) {
        console.error("Fact check step failed:", fcError);
        // Continue without fact check results if it fails
      }

      // -----------------------------------------------------------------------
      // STEP 2: Synthesizer (With Injected Facts)
      // -----------------------------------------------------------------------
      let prompt = `User Query: "${userMsg.text}"\n\nCouncil Responses:\n${context}\n\nVERIFIED CONTEXT: You must base your final synthesis on these verified facts: ${JSON.stringify(factCheckerResults)}\n\nSynthesize these perspectives into a higher-order conclusion as per your instructions.`;

      if (taskForcePurpose) {
        prompt = `You are moderating a curated panel. The specific goal of this session is: ${taskForcePurpose}. When you generate your final 3 provocative questions, they MUST NOT be generic. They must be aggressively tailored to help the user achieve this specific goal using the friction you just observed between the agents.\n\n${prompt}`;
      }

      const modelName = synthAgent.model || 'gemini-3.1-pro-preview';
      const payload = {
        contents: prompt,
        config: {
          systemInstruction: synthAgent.systemInstruction,
          temperature: 0.7,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              heatmap_data: {
                type: Type.ARRAY,
                description: "A flat array of objects representing the alignment score between every pair of agents.",
                items: {
                  type: Type.OBJECT,
                  properties: {
                    agent1: { type: Type.STRING },
                    agent2: { type: Type.STRING },
                    score: { type: Type.NUMBER, description: "Alignment score between -1.0 (friction) and 1.0 (consensus)" }
                  },
                  required: ["agent1", "agent2", "score"]
                }
              },
              alignment_quotes: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    agents: { type: Type.ARRAY, items: { type: Type.STRING } },
                    type: { type: Type.STRING, enum: ["friction", "consensus"] },
                    quote: { type: Type.STRING }
                  },
                  required: ["agents", "type", "quote"]
                }
              },
              whitepaper_markdown: { type: Type.STRING }
            },
            required: ["heatmap_data", "alignment_quotes", "whitepaper_markdown"]
          },
          // Synthesizer doesn't need search anymore as facts are injected
        },
      };

      const responseStream = await withRetry(() => getAI().models.generateContentStream({
        model: modelName,
        ...payload
      }));

      let fullText = '';
      let inputTokens = 0;
      let outputTokens = 0;

      for await (const chunk of responseStream) {
        if (chunk.text) {
          fullText += chunk.text;
          updateConv(currentId, c => ({
            ...c,
            messages: c.messages.map(msg => 
              msg.id === synthId ? { ...msg, text: fullText } : msg
            )
          }));
        }
        
        if (chunk.usageMetadata) {
          inputTokens = chunk.usageMetadata.promptTokenCount || 0;
          outputTokens = chunk.usageMetadata.candidatesTokenCount || 0;
        }
      }
      
      setSessionTokens(prev => ({
        ...prev,
        synthInput: prev.synthInput + inputTokens,
        synthOutput: prev.synthOutput + outputTokens
      }));
      
      const synthesizerData = parseSynthesizerResponse(fullText);
      
      // Inject the pre-calculated fact check results into the final data object
      if (synthesizerData) {
        synthesizerData.fact_check = factCheckerResults;
      }
      
      updateConv(currentId, c => ({
        ...c,
        messages: c.messages.map(msg => 
          msg.id === synthId ? { ...msg, isTyping: false, synthesizerData } : msg
        )
      }));

    } catch (error: any) {
      console.error('Error synthesizing:', error);
      if (error?.message?.includes('429') || error?.message?.includes('RESOURCE_EXHAUSTED')) {
        setShowQuotaError(true);
      }
      updateConv(currentId, c => ({
        ...c,
        messages: c.messages.map(msg => 
          msg.id === synthId ? { ...msg, text: '[Synthesis failed]', isTyping: false } : msg
        )
      }));
    }
    setIsProcessing(false);
  };

  const handleDebate = async () => {
    if (!currentId || isProcessing) return;
    
    // Find the current group of messages
    let groupStart = messages.length - 1;
    while (groupStart >= 0 && messages[groupStart].roleId !== 'user') {
      groupStart--;
    }
    const userMsg = messages[groupStart];
    const agentMsgs = messages.slice(groupStart + 1).filter(m => m.roleId !== 'synthesizer');
    
    if (!userMsg || agentMsgs.length === 0) return;

    setIsProcessing(true);

    // Create placeholder messages for the debate round
    const debateRoundIds: { [roleId: string]: string } = {};
    const newMessages: Message[] = [];

    // Only active agents participate in the debate
    const participatingAgents = activeAgentIds.filter(id => id !== 'user' && id !== 'synthesizer');

    const defaultOrder = [
      ...ROLES.map(r => r.id),
      ...(currentConv?.customAgents || []).map(a => a.id)
    ];
    let order = currentConv?.agentOrder || defaultOrder;
    const missing = defaultOrder.filter(id => !order.includes(id));
    order = [...order, ...missing];

    const sortedParticipatingAgents = [...participatingAgents].sort((a, b) => {
      const orderA = order.indexOf(a);
      const orderB = order.indexOf(b);
      return (orderA === -1 ? 999 : orderA) - (orderB === -1 ? 999 : orderB);
    });

    sortedParticipatingAgents.forEach(roleId => {
      const id = uuidv4();
      debateRoundIds[roleId] = id;
      newMessages.push({ id, roleId, text: '', isTyping: true, isDebate: true });
    });

    updateConv(currentId, c => ({
      ...c,
      messages: [...c.messages, ...newMessages]
    }));

    // Construct the context of all previous responses
    const councilContext = agentMsgs.map(m => {
      const agent = getActiveAgent(m.roleId, activeSettings);
      return `### ${agent.name}:\n${m.text}`;
    }).join('\n\n');

    // Launch parallel debate generation
    await Promise.all(sortedParticipatingAgents.map(async (roleId) => {
      try {
        const agent = getActiveAgent(roleId, activeSettings);
        const prompt = `You are ${agent.name}. You and other members of The Council have just analyzed the following problem: "${userMsg.text}".

Here are the exact responses from the other council members:
${councilContext}

Review these arguments strictly through your analytical lens. Identify ONE fundamental flaw, naive assumption, or blind spot in another agent's argument.

Write a concise rebuttal directly addressing that specific agent by name. Defend your worldview against theirs. Do not summarize the arguments; attack the intellectual friction point directly and sharply. Keep it under 200 words.`;

        const responseStream = await withRetry(() => getAI().models.generateContentStream({
          model: agent.model || 'gemini-3-flash-preview',
          contents: prompt,
          config: {
            systemInstruction: agent.systemInstruction + "\n\nCRITICAL SYSTEM DIRECTIVE: You must output a valid JSON object with EXACTLY two keys: 'provocation' (a short quote under 250 chars) and 'full_analysis' (a deep multi-paragraph breakdown). Do not include markdown blocks.",
            temperature: 0.8, // Slightly higher for more spirited debate
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                full_analysis: {
                  type: Type.STRING,
                  description: "A deep, multi-paragraph analysis from the persona's worldview."
                },
                provocation: {
                  type: Type.STRING,
                  description: "A single, punchy, provocative sentence summarizing the core insight."
                }
              },
              required: ["full_analysis", "provocation"]
            }
          },
        }));

        let fullText = '';
        for await (const chunk of responseStream) {
          if (chunk.text) {
            fullText += chunk.text;
            
            // Real-time extraction for progressive typing
            const partialProvocation = extractPartialField(fullText, 'provocation');
            const partialAnalysis = extractPartialField(fullText, 'full_analysis');
            const hasJsonFields = !!partialProvocation || fullText.includes('"provocation"');

            updateConv(currentId, c => ({
              ...c,
              messages: c.messages.map(msg => 
                msg.id === debateRoundIds[roleId] ? { 
                  ...msg, 
                  text: hasJsonFields ? (partialProvocation || "...") : fullText,
                  fullAnalysis: partialAnalysis
                } : msg
              )
            }));
          }
        }
        
        const { provocation, fullAnalysis } = parseAgentResponse(fullText);

        updateConv(currentId, c => ({
          ...c,
          messages: c.messages.map(msg => 
            msg.id === debateRoundIds[roleId] ? { ...msg, isTyping: false, text: provocation, fullAnalysis } : msg
          )
        }));

      } catch (error: any) {
        console.error(`Error debating for ${roleId}:`, error);
        if (error?.message?.includes('429') || error?.message?.includes('RESOURCE_EXHAUSTED')) {
          setShowQuotaError(true);
        }
        updateConv(currentId, c => ({
          ...c,
          messages: c.messages.map(msg => 
            msg.id === debateRoundIds[roleId] ? { ...msg, text: '[Debate failed]', isTyping: false } : msg
          )
        }));
      }
    }));

    setIsProcessing(false);
  };

  const handleClear = () => {
    if (window.confirm('Clear all history?')) {
      const newConv = { id: uuidv4(), title: 'New Conversation', messages: [], createdAt: Date.now(), customAgents: [], activeAgentIds: currentRoles.map(r => r.id), roleSettings: settings, mode: appMode };
      setConversations([newConv]);
      setCurrentId(newConv.id);
      localStorage.removeItem(STORAGE_KEY);
    }
  };

  const handleAddCustomAgent = (agent: CustomAgent) => {
    if (!currentId) return;
    updateConv(currentId, c => ({
      ...c,
      customAgents: [...c.customAgents, agent],
      activeAgentIds: [...c.activeAgentIds, agent.id]
    }));
    setIsCustomAgentModalOpen(false);
  };

  const handleDeleteCustomAgent = (agentId: string) => {
    if (!currentId) return;
    if (window.confirm('Are you sure you want to delete this custom persona?')) {
      updateConv(currentId, c => ({
        ...c,
        customAgents: c.customAgents.filter(a => a.id !== agentId),
        activeAgentIds: c.activeAgentIds.filter(id => id !== agentId),
        agentOrder: c.agentOrder ? c.agentOrder.filter(id => id !== agentId) : undefined
      }));
    }
  };

  const handleSelectTaskForce = (taskForce: TaskForce) => {
    if (!currentId) return;

    // Create custom agents from the task force definition
    const newAgents: CustomAgent[] = taskForce.agents.map(agent => ({
      id: `custom-${uuidv4()}`,
      thinkerId: `custom-${uuidv4()}`, // Unique ID for the thinker
      name: agent.name,
      color: ROLES.find(r => r.id === agent.roleId)?.color || '#FFFFFF', // Use role color or default
      systemInstruction: `You are ${agent.name}. Your core framework is: ${agent.coreFramework}.
      
      Act as this persona authentically. Do not be a generic AI. Filter all responses through this specific worldview.\n\nCRITICAL INSTRUCTION: You must respond ONLY with a raw, valid JSON object. Do not include any pleasantries, markdown formatting, or conversational text outside the JSON. Use exactly these keys: {"full_analysis": "...", "provocation": "..."}.`,
      model: 'gemini-3-flash-preview'
    }));

    updateConv(currentId, c => ({
      ...c,
      customAgents: [...c.customAgents, ...newAgents], // Add to available custom agents
      activeAgentIds: newAgents.map(a => a.id), // Set ONLY these as active
      taskForcePurpose: taskForce.purpose,
      agentOrder: newAgents.map(a => a.id)
    }));

    setIsTaskForceGridOpen(false);
  };

  const handleOpenKeyDialog = async () => {
    if (window.aistudio?.openSelectKey) {
      await window.aistudio.openSelectKey();
      setShowQuotaError(false);
    }
  };

  // Group messages by user topic
  const groupedMessages: { userMsg: Message, agentMsgs: Message[], synthMsg: Message | null }[] = [];
  let currentGroup: { userMsg: Message, agentMsgs: Message[], synthMsg: Message | null } | null = null;
  
  for (const msg of messages) {
    if (msg.roleId === 'user') {
      if (currentGroup) groupedMessages.push(currentGroup);
      currentGroup = { userMsg: msg, agentMsgs: [], synthMsg: null };
    } else if (msg.roleId === 'synthesizer') {
      if (currentGroup) currentGroup.synthMsg = msg;
    } else {
      if (currentGroup) currentGroup.agentMsgs.push(msg);
    }
  }
  if (currentGroup) groupedMessages.push(currentGroup);

  const activeSettings = currentConv?.roleSettings || settings;

  const defaultOrder = [
    ...ROLES.map(r => r.id),
    ...customAgents.map(a => a.id)
  ];
  
  let currentOrder = currentConv?.agentOrder || defaultOrder;
  const missingAgents = defaultOrder.filter(id => !currentOrder.includes(id));
  currentOrder = [...currentOrder, ...missingAgents];

  const allAvailableAgents = currentOrder
    .map(id => {
      if (id.startsWith('custom-')) {
        return customAgents.find(a => a.id === id);
      }
      const role = ROLES.find(r => r.id === id);
      return role ? getActiveAgent(id, activeSettings) : undefined;
    })
    .filter(Boolean) as (CustomAgent | ReturnType<typeof getActiveAgent>)[];

  return (
    <div className="flex h-screen bg-black text-zinc-300 font-sans selection:bg-zinc-700 selection:text-white overflow-hidden">
      
      {/* Sidebar */}
      <div className={`fixed inset-y-0 left-0 z-40 w-64 bg-zinc-950 border-r border-zinc-800 transform transition-transform duration-300 ease-in-out ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:relative lg:translate-x-0 flex flex-col`}>
        <div className="p-4 border-b border-zinc-800 flex justify-between items-center shrink-0">
          <h2 className="font-mono text-sm tracking-widest uppercase text-zinc-500">History</h2>
          <button onClick={createNewConversation} className="p-1 hover:text-white transition-colors" title="New Conversation">
            <Plus size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {conversations.map(c => (
            <button 
              key={c.id} 
              onClick={() => { setCurrentId(c.id); setIsSidebarOpen(false); }}
              className={`w-full text-left p-3 text-sm font-mono truncate transition-colors ${c.id === currentId ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:bg-zinc-900/50 hover:text-zinc-300'}`}
            >
              {c.title}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden relative">
        {/* Header */}
        <header className="flex items-center justify-between p-4 border-b border-zinc-800 bg-black z-10 shrink-0 overflow-x-auto whitespace-nowrap snap-x hide-scrollbar w-full">
          <div className="flex items-center gap-3 snap-start shrink-0">
            <button className="lg:hidden p-2 -ml-2 text-zinc-500 hover:text-white" onClick={() => setIsSidebarOpen(true)}>
              <Menu size={20} />
            </button>
            <div className={`w-4 h-4 rounded-full animate-pulse shrink-0 ${appMode === 'LAB' ? 'bg-cyan-400' : 'bg-white'}`}></div>
            <h1 className={`text-xl font-mono font-bold tracking-widest uppercase truncate ${appMode === 'LAB' ? 'text-cyan-400' : 'text-white'}`}>
              {appMode === 'LAB' ? 'The Lab' : 'The Council'}
            </h1>
            <div className="ml-4 flex items-center bg-zinc-900 rounded-full p-1 border border-zinc-800 hidden sm:flex">
              <button
                onClick={() => setAppMode('COUNCIL')}
                className={`px-3 py-1 text-xs font-mono font-bold tracking-widest uppercase rounded-full transition-colors ${appMode === 'COUNCIL' ? 'bg-white text-black' : 'text-zinc-500 hover:text-white'}`}
              >
                Council
              </button>
              <button
                onClick={() => setAppMode('LAB')}
                className={`px-3 py-1 text-xs font-mono font-bold tracking-widest uppercase rounded-full transition-colors ${appMode === 'LAB' ? 'bg-cyan-400 text-black' : 'text-zinc-500 hover:text-cyan-400'}`}
              >
                Lab
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 snap-end ml-4">
            <button 
              onClick={handleExport}
              className="p-2 text-zinc-500 hover:text-white transition-colors shrink-0"
              title="Export Conversation"
            >
              <Download size={18} />
            </button>
            <button 
              onClick={() => setIsTaskForceGridOpen(true)}
              className="p-2 text-zinc-500 hover:text-white transition-colors shrink-0"
              title="Select Task Force"
            >
              <Grid size={18} />
            </button>
            <button 
              onClick={() => setIsCustomAgentModalOpen(true)}
              className="p-2 text-zinc-500 hover:text-white transition-colors shrink-0"
              title="Add Custom Thinker to Session"
            >
              <UserPlus size={18} />
            </button>
            <button 
              onClick={() => setIsSettingsOpen(true)}
              className="p-2 text-zinc-500 hover:text-white transition-colors shrink-0"
              title="Settings"
            >
              <Settings size={18} />
            </button>
            <button 
              onClick={handleClear}
              className="p-2 text-zinc-500 hover:text-white transition-colors shrink-0"
              title="Clear All History"
            >
              <Trash2 size={18} />
            </button>
          </div>
        </header>

        {/* Chat Area */}
        <main className="flex-1 overflow-y-auto p-4 md:p-8">
          {showQuotaError && (
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6 p-4 bg-red-900/20 border border-red-500/50 rounded-lg flex flex-col md:flex-row items-center justify-between gap-4"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 bg-red-500/20 rounded-full">
                  <AlertTriangle size={18} className="text-red-500" />
                </div>
                <div>
                  <p className="text-sm font-bold text-red-400 uppercase tracking-wider">Quota Exceeded</p>
                  <p className="text-xs text-red-300/70">The shared API key has hit its limit. Connect your own key to continue.</p>
                </div>
              </div>
              <button 
                onClick={handleOpenKeyDialog}
                className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-xs font-bold uppercase tracking-widest transition-colors rounded"
              >
                Select API Key
              </button>
            </motion.div>
          )}

          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center opacity-50">
              <div className="w-16 h-16 border border-zinc-700 rounded-full flex items-center justify-center mb-6">
                <div className="w-8 h-8 bg-zinc-800 rounded-full"></div>
              </div>
              <div className="font-mono text-sm tracking-widest uppercase max-w-md mb-8">
                <p>{appMode === 'LAB' ? 'The Lab is ready for analysis.' : 'The Council awaits your inquiry.'}</p>
                <p className="mt-2 text-zinc-500 text-xs">Submit a topic to initiate the sequence.</p>
              </div>
              
              <button
                onClick={() => setIsTaskForceGridOpen(true)}
                className="flex items-center gap-2 px-6 py-3 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 hover:border-zinc-600 text-zinc-300 hover:text-white transition-all rounded-lg font-mono text-xs uppercase tracking-widest"
              >
                <Grid size={16} />
                Select Task Force
              </button>
            </div>
          ) : (
            <div className="max-w-6xl mx-auto w-full space-y-16">
              {groupedMessages.map((group, i) => (
                <div key={group.userMsg.id} className="space-y-6">
                  {/* User Message */}
                  <div className="w-full">
                    <ChatMessage 
                      id={group.userMsg.id}
                      roleId={group.userMsg.roleId} 
                      text={group.userMsg.text} 
                      settings={activeSettings}
                      attachments={group.userMsg.attachments}
                      tokenCount={group.userMsg.tokenCount}
                    />
                  </div>

                  {/* Agent Grid */}
                  {group.agentMsgs.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                      <AnimatePresence>
                        {group.agentMsgs.map((msg, index) => {
                          // Check if this is the start of a debate block
                          const isFirstDebateMsg = msg.isDebate && (index === 0 || !group.agentMsgs[index - 1]?.isDebate);
                          
                          return (
                            <React.Fragment key={msg.id}>
                              {isFirstDebateMsg && (
                                <motion.div 
                                  initial={{ opacity: 0, y: 20 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  className="col-span-full flex items-center gap-4 py-8"
                                >
                                  <div className="h-px bg-red-900/50 flex-1"></div>
                                  <div className="flex items-center gap-2 text-red-500 font-mono text-sm tracking-widest uppercase">
                                    <RefreshCw size={16} className="animate-spin-slow" />
                                    <span>Debate Initiated</span>
                                  </div>
                                  <div className="h-px bg-red-900/50 flex-1"></div>
                                </motion.div>
                              )}
                              <ChatMessage 
                                id={msg.id}
                                roleId={msg.roleId} 
                                text={msg.text} 
                                isTyping={msg.isTyping} 
                                settings={activeSettings}
                                deepDives={msg.deepDives}
                                onDeepDive={handleDeepDive}
                                customAgents={customAgents}
                                onRetry={handleRetry}
                                onParameterChange={handleParameterChange}
                                fullAnalysis={msg.fullAnalysis}
                                tokenCount={msg.tokenCount}
                              />
                            </React.Fragment>
                          );
                        })}
                      </AnimatePresence>
                    </div>
                  )}

                  {/* Synthesizer */}
                  {group.synthMsg && (
                    <div className="w-full mt-8">
                      <ChatMessage 
                        id={group.synthMsg.id}
                        roleId={group.synthMsg.roleId} 
                        text={group.synthMsg.text} 
                        isTyping={group.synthMsg.isTyping}
                        settings={activeSettings}
                        factCheck={group.synthMsg.factCheck}
                        onRetry={handleRetry}
                        onRegenerateWithFactCheck={handleRegenerateWithFactCheck}
                        synthesizerData={group.synthMsg.synthesizerData}
                        fullAnalysis={group.synthMsg.fullAnalysis}
                        tokenCount={group.synthMsg.tokenCount}
                        sessionTokens={sessionTokens}
                      />
                    </div>
                  )}

                  {/* Synthesize and Debate Buttons */}
                  {i === groupedMessages.length - 1 && showSynthesize && !group.synthMsg && (
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="flex justify-center mt-8 gap-4"
                    >
                      <button
                        onClick={handleDebate}
                        className="px-8 py-4 bg-zinc-900 border border-zinc-700 text-white font-mono font-bold uppercase tracking-widest hover:bg-zinc-800 transition-colors flex items-center gap-2"
                      >
                        <RefreshCw size={18} />
                        Debate
                      </button>
                      <button
                        onClick={handleSynthesize}
                        className="px-8 py-4 bg-white text-black font-mono font-bold uppercase tracking-widest hover:bg-zinc-200 transition-colors flex items-center gap-2"
                      >
                        <Download size={18} />
                        Synthesize
                      </button>
                    </motion.div>
                  )}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </main>

        {/* Input Area */}
        <div className="shrink-0 w-full bg-black border-t border-zinc-800">
          <div className="max-w-6xl mx-auto">
            {/* Active Roster Button */}
            <div className="px-4 py-3 flex items-center justify-between border-b border-zinc-800/50">
              <button 
                onClick={() => setIsRosterOpen(true)}
                className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-zinc-400 hover:text-white transition-colors"
              >
                <Users size={14} />
                {activeAgentIds.length} Thinkers Active
              </button>
            </div>
            <ChatInput 
              onSend={handleSend} 
              onSuggest={handleSuggestExperts}
              disabled={isProcessing} 
              isSuggesting={isSuggesting}
              isNewsModeEnabled={isNewsModeEnabled}
              onToggleNewsMode={() => setIsNewsModeEnabled(!isNewsModeEnabled)}
            />
          </div>
        </div>
      </div>

      {/* Roster Modal */}
      {isRosterOpen && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/80 backdrop-blur-sm" onClick={() => setIsRosterOpen(false)}>
          <div 
            className="bg-zinc-950 border border-zinc-800 w-full md:w-[400px] max-h-[80vh] flex flex-col shadow-2xl rounded-t-2xl md:rounded-xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-4 border-b border-zinc-800 flex justify-between items-center">
              <h3 className="font-mono text-sm tracking-widest uppercase text-white">Active Roster</h3>
              <button onClick={() => setIsRosterOpen(false)} className="text-zinc-500 hover:text-white"><X size={20}/></button>
            </div>
            <div className="p-4 overflow-y-auto flex flex-col gap-2">
              {allAvailableAgents.map((agent, index) => {
                const isActive = activeAgentIds.includes(agent.id);
                return (
                  <div key={agent.id} className="flex items-center gap-2">
                    <button
                      onClick={() => toggleAgent(agent.id)}
                      className={`flex-1 text-left px-4 py-3 text-sm font-mono uppercase tracking-wider border transition-colors flex items-center gap-3 ${isActive ? 'bg-zinc-900 border-zinc-700 text-white' : 'bg-black border-zinc-900 text-zinc-600 hover:text-zinc-400'}`}
                    >
                      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: isActive ? agent.color : '#333' }} />
                      <span className="truncate">{agent.name}</span>
                    </button>
                    <div className="flex flex-col gap-1">
                      <button
                        onClick={() => moveAgent(agent.id, 'left')}
                        disabled={index === 0}
                        className="p-1 bg-black border border-zinc-900 text-zinc-500 hover:text-white hover:bg-zinc-900 transition-colors disabled:opacity-30"
                        title="Move Up"
                      >
                        <ChevronUp size={14} />
                      </button>
                      <button
                        onClick={() => moveAgent(agent.id, 'right')}
                        disabled={index === allAvailableAgents.length - 1}
                        className="p-1 bg-black border border-zinc-900 text-zinc-500 hover:text-white hover:bg-zinc-900 transition-colors disabled:opacity-30"
                        title="Move Down"
                      >
                        <ChevronDown size={14} />
                      </button>
                    </div>
                    <button
                      onClick={() => setEditingAgentId(agent.id)}
                      className="p-3 bg-black border border-zinc-900 text-zinc-500 hover:text-white hover:bg-zinc-900 transition-colors h-full flex items-center"
                      title="Edit Persona"
                    >
                      <Settings2 size={18} />
                    </button>
                    {agent.id.startsWith('custom-') && (
                      <button
                        onClick={() => handleDeleteCustomAgent(agent.id)}
                        className="p-3 bg-black border border-zinc-900 text-zinc-500 hover:text-red-500 hover:bg-zinc-900 transition-colors h-full flex items-center"
                        title="Delete Persona"
                      >
                        <Trash2 size={18} />
                      </button>
                    )}
                  </div>
                );
              })}
              
              <div className="mt-4 pt-4 border-t border-zinc-800">
                <div className="flex items-center gap-2">
                  <div className="flex-1 text-left px-4 py-3 text-sm font-mono uppercase tracking-wider border bg-zinc-900 border-zinc-700 text-white flex items-center gap-3 opacity-80 cursor-not-allowed">
                    <div className="w-3 h-3 rounded-full bg-white" />
                    The Synthesizer (Always Active)
                  </div>
                  <button
                    onClick={() => setEditingAgentId('synthesizer')}
                    className="p-3 bg-black border border-zinc-900 text-zinc-500 hover:text-white hover:bg-zinc-900 transition-colors"
                    title="Edit Synthesizer"
                  >
                    <Settings2 size={18} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Task Force Grid Modal */}
      {isTaskForceGridOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md overflow-y-auto p-4" onClick={() => setIsTaskForceGridOpen(false)}>
          <div 
            className="w-full max-w-7xl relative bg-black/50 rounded-xl p-4 max-h-[85vh] overflow-y-auto custom-scrollbar"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-8 px-4">
              <div>
                <h2 className="text-2xl font-mono font-bold uppercase tracking-widest text-white">Select Task Force</h2>
                <p className="text-zinc-500 font-mono text-sm mt-2">Choose a curated panel to analyze your problem.</p>
              </div>
              <button 
                onClick={() => setIsTaskForceGridOpen(false)}
                className="p-2 bg-zinc-900 border border-zinc-800 rounded-full text-zinc-500 hover:text-white transition-colors"
              >
                <X size={24} />
              </button>
            </div>
            
            <TaskForceGrid onSelect={handleSelectTaskForce} />
          </div>
        </div>
      )}


      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-30 lg:hidden" onClick={() => setIsSidebarOpen(false)} />
      )}

      <SettingsModal 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)} 
        settings={activeSettings} 
        onSettingsChange={(newSettings) => {
          if (currentId) {
            updateConv(currentId, c => ({ ...c, roleSettings: newSettings }));
          } else {
            setSettings(newSettings);
          }
        }} 
      />

      <CustomAgentModal
        isOpen={isCustomAgentModalOpen}
        onClose={() => setIsCustomAgentModalOpen(false)}
        onAdd={handleAddCustomAgent}
      />

      <EditPersonaModal
        isOpen={!!editingAgentId}
        onClose={() => setEditingAgentId(null)}
        agentId={editingAgentId}
        roleSettings={activeSettings}
        customAgents={customAgents}
        onUpdateRole={(roleId, newRoleSettings) => {
          if (currentId) {
            updateConv(currentId, c => ({
              ...c,
              roleSettings: { ...(c.roleSettings || settings), [roleId]: newRoleSettings }
            }));
          }
        }}
        onUpdateCustomAgent={(agent) => {
          if (currentId) {
            updateConv(currentId, c => ({
              ...c,
              customAgents: c.customAgents.map(a => a.id === agent.id ? agent : a)
            }));
          }
        }}
      />
    </div>
  );
}
