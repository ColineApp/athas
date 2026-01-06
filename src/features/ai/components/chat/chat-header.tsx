import { invoke } from "@tauri-apps/api/core";
import {
  Check,
  ChevronDown,
  Download,
  History,
  LogIn,
  Plus,
  RefreshCw,
  Terminal,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AgentConfig } from "@/features/ai/types/acp";
import { AGENT_OPTIONS, type AgentType } from "@/features/ai/types/ai-chat";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";
import { useAIChatStore } from "../../store/store";

type PackageManager = "bun" | "npm" | "pnpm" | "yarn";

const AGENT_INSTALL_HINTS: Record<
  string,
  { package?: string; command?: string; type?: "npm" | "pip" | "shell"; loginCommand?: string }
> = {
  "claude-code": { package: "@anthropic-ai/claude-code", type: "npm", loginCommand: "claude" },
  "codex-cli": { package: "@openai/codex", type: "npm", loginCommand: "codex auth login" },
  "gemini-cli": { package: "@google/gemini-cli", type: "npm", loginCommand: "gemini" },
  "kimi-cli": { package: "kimi-cli", type: "npm", loginCommand: "kimi auth login" },
  opencode: {
    command: "curl -fsSL https://opencode.ai/install | bash",
    type: "shell",
    loginCommand: "opencode auth",
  },
  "qwen-code": { command: "pip install qwen-code", type: "pip", loginCommand: "qwen-code auth" },
};

const getInstallCommand = (pkg: string, pm: PackageManager): string => {
  switch (pm) {
    case "bun":
      return `bun install -g ${pkg}`;
    case "pnpm":
      return `pnpm add -g ${pkg}`;
    case "yarn":
      return `yarn global add ${pkg}`;
    default:
      return `npm install -g ${pkg}`;
  }
};

function EditableChatTitle({
  title,
  onUpdateTitle,
}: {
  title: string;
  onUpdateTitle: (title: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEditing) {
      setEditValue(title);
    }
  }, [title, isEditing]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSave = () => {
    const trimmedValue = editValue.trim();
    if (trimmedValue && trimmedValue !== title) {
      onUpdateTitle(trimmedValue);
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditValue(title);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleCancel();
    }
  };

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
        className="rounded border-none bg-transparent px-1 py-0.5 font-medium text-text outline-none focus:bg-hover"
        style={{ minWidth: "100px", maxWidth: "200px" }}
      />
    );
  }

  return (
    <span
      className="cursor-pointer rounded px-1 py-0.5 font-medium transition-colors hover:bg-hover"
      onClick={() => setIsEditing(true)}
      title="Click to rename chat"
    >
      {title}
    </span>
  );
}

export function ChatHeader() {
  const currentChatId = useAIChatStore((state) => state.currentChatId);
  const getCurrentChat = useAIChatStore((state) => state.getCurrentChat);
  const getCurrentAgentId = useAIChatStore((state) => state.getCurrentAgentId);
  const isChatHistoryVisible = useAIChatStore((state) => state.isChatHistoryVisible);
  const setIsChatHistoryVisible = useAIChatStore((state) => state.setIsChatHistoryVisible);
  const createNewChat = useAIChatStore((state) => state.createNewChat);
  const updateChatTitle = useAIChatStore((state) => state.updateChatTitle);

  const [isNewChatMenuOpen, setIsNewChatMenuOpen] = useState(false);
  const [installedAgents, setInstalledAgents] = useState<Set<string>>(new Set(["custom"]));
  const [packageManager, setPackageManager] = useState<PackageManager>("bun");
  const [pmDropdownAgent, setPmDropdownAgent] = useState<string | null>(null);
  const [pendingLogin, setPendingLogin] = useState<{ agentId: string; agentName: string } | null>(
    null,
  );
  const [isRefreshing, setIsRefreshing] = useState(false);

  const currentChat = getCurrentChat();
  const currentAgentId = getCurrentAgentId();
  const currentAgent = AGENT_OPTIONS.find((a) => a.id === currentAgentId);

  // Function to detect installed agents
  const detectAgents = async () => {
    try {
      setIsRefreshing(true);
      const availableAgents = await invoke<AgentConfig[]>("get_available_agents");
      const installed = new Set<string>(["custom"]);
      for (const agent of availableAgents) {
        if (agent.installed) {
          installed.add(agent.id);
        }
      }
      setInstalledAgents(installed);
    } catch (error) {
      console.error("Failed to detect agents:", error);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Detect installed agents on mount
  useEffect(() => {
    detectAgents();
  }, []);

  // Handle refresh button click
  const handleRefreshAgents = async () => {
    await detectAgents();
  };

  const handleNewChat = async (agentId: AgentType) => {
    if (!installedAgents.has(agentId) && agentId !== "custom") return;

    setIsNewChatMenuOpen(false);

    // Stop any running ACP agent before starting a new chat
    if (currentAgent?.isAcp) {
      try {
        await invoke("stop_acp_agent");
      } catch (error) {
        console.error("Failed to stop current agent:", error);
      }
    }

    const newChatId = createNewChat(agentId);
    return newChatId;
  };

  const handleInstall = (agentId: string, agentName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const hint = AGENT_INSTALL_HINTS[agentId];
    if (!hint) return;

    let command: string;
    if (hint.type === "npm" && hint.package) {
      command = getInstallCommand(hint.package, packageManager);
    } else if (hint.command) {
      command = hint.command;
    } else {
      return;
    }

    // Create a new terminal and run the install command
    window.dispatchEvent(
      new CustomEvent("create-terminal-with-command", {
        detail: { command, name: `Install ${agentName}` },
      }),
    );

    // Set pending login so user can login after installation
    if (hint.loginCommand) {
      setPendingLogin({ agentId, agentName });
    }

    setIsNewChatMenuOpen(false);
  };

  const handleLogin = (agentId: string, agentName: string) => {
    const hint = AGENT_INSTALL_HINTS[agentId];
    if (!hint?.loginCommand) return;

    // Create a new terminal and run the login command
    window.dispatchEvent(
      new CustomEvent("create-terminal-with-command", {
        detail: { command: hint.loginCommand, name: `Login to ${agentName}` },
      }),
    );

    setPendingLogin(null);
    // Refresh agents after a short delay to pick up the newly installed agent
    setTimeout(() => detectAgents(), 2000);
  };

  const handleDismissPendingLogin = () => {
    setPendingLogin(null);
    // Still refresh to detect the installed agent
    detectAgents();
  };

  const handleSelectPm = (pm: PackageManager, e: React.MouseEvent) => {
    e.stopPropagation();
    setPackageManager(pm);
    setPmDropdownAgent(null);
  };

  const packageManagers: PackageManager[] = ["bun", "npm", "pnpm", "yarn"];

  return (
    <div className="relative flex items-center gap-2 border-border border-b bg-secondary-bg px-1.5 py-0.5">
      {/* Agent indicator */}
      <div className="flex items-center gap-1 rounded bg-primary-bg px-1.5 py-0.5 text-xs">
        <Terminal size={10} className="text-text-lighter" />
        <span className="text-text-light">{currentAgent?.name || "Custom"}</span>
      </div>

      {currentChatId ? (
        <EditableChatTitle
          title={currentChat ? currentChat.title : "New Chat"}
          onUpdateTitle={(title) => updateChatTitle(currentChatId, title)}
        />
      ) : (
        <span className="font-medium text-text text-xs">New Chat</span>
      )}

      <div className="flex-1" />

      <Tooltip content="Chat History" side="bottom">
        <button
          onClick={() => setIsChatHistoryVisible(!isChatHistoryVisible)}
          className="flex size-6 items-center justify-center rounded p-0 text-text-lighter transition-colors hover:bg-hover"
          aria-label="Toggle chat history"
        >
          <History size={14} />
        </button>
      </Tooltip>

      {/* New Chat with agent dropdown */}
      <div className="relative">
        <Tooltip content="New Chat" side="bottom">
          <button
            onClick={() => setIsNewChatMenuOpen(!isNewChatMenuOpen)}
            className="flex size-6 items-center justify-center rounded p-0 text-text-lighter transition-colors hover:bg-hover"
            aria-label="New chat"
          >
            <Plus size={10} />
            <ChevronDown size={8} />
          </button>
        </Tooltip>

        {isNewChatMenuOpen && (
          <>
            <div className="fixed inset-0 z-9998" onClick={() => setIsNewChatMenuOpen(false)} />
            <div className="absolute top-full right-0 z-9999 mt-1 w-[280px] rounded-lg border border-border bg-primary-bg py-1 shadow-xl">
              <div className="flex items-center justify-between px-3 py-1.5">
                <span className="text-text-lighter text-xs">New Chat with...</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRefreshAgents();
                  }}
                  className={cn(
                    "flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-text-lighter transition-colors hover:bg-hover hover:text-text",
                    isRefreshing && "animate-spin",
                  )}
                  title="Refresh installed agents"
                >
                  <RefreshCw size={10} className={isRefreshing ? "animate-spin" : ""} />
                  {!isRefreshing && <span>Refresh</span>}
                </button>
              </div>
              {AGENT_OPTIONS.map((agent) => {
                const isInstalled = installedAgents.has(agent.id);
                const installHint = AGENT_INSTALL_HINTS[agent.id];
                const isPmOpen = pmDropdownAgent === agent.id;
                const showPmDropdown =
                  !isInstalled && agent.id !== "custom" && installHint?.type === "npm";

                return (
                  <div key={agent.id} className="group relative">
                    <button
                      onClick={() => handleNewChat(agent.id)}
                      disabled={!isInstalled && agent.id !== "custom"}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors",
                        isInstalled || agent.id === "custom"
                          ? "hover:bg-hover"
                          : "cursor-default opacity-60",
                      )}
                    >
                      <Terminal size={10} className="text-text-lighter" />
                      <span className="flex-1 text-text">{agent.name}</span>
                      {isInstalled && agent.id !== "custom" && (
                        <Check size={10} className="text-green-500" />
                      )}
                    </button>

                    {/* Install button for non-installed agents */}
                    {!isInstalled && agent.id !== "custom" && installHint && (
                      <div className="absolute top-0.5 right-2 flex items-center">
                        <button
                          onClick={(e) => handleInstall(agent.id, agent.name, e)}
                          className={cn(
                            "flex items-center gap-1 bg-accent/20 px-2 py-1 text-accent text-xs transition-colors hover:bg-accent/30",
                            showPmDropdown ? "rounded-l" : "rounded",
                          )}
                          title="Install agent"
                        >
                          <Download size={10} />
                          <span>Install</span>
                        </button>
                        {showPmDropdown && (
                          <div className="relative">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setPmDropdownAgent(isPmOpen ? null : agent.id);
                              }}
                              className="flex items-center gap-0.5 rounded-r border-accent/30 border-l bg-accent/20 px-1.5 py-1 text-accent text-xs transition-colors hover:bg-accent/30"
                            >
                              <span>{packageManager}</span>
                              <ChevronDown size={10} />
                            </button>
                            {isPmOpen && (
                              <div className="absolute top-full right-0 z-10 mt-1 min-w-[70px] rounded border border-border bg-secondary-bg py-1 shadow-lg">
                                {packageManagers.map((pm) => (
                                  <button
                                    key={pm}
                                    onClick={(e) => handleSelectPm(pm, e)}
                                    className={cn(
                                      "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-hover",
                                      packageManager === pm ? "text-accent" : "text-text-light",
                                    )}
                                  >
                                    {packageManager === pm && <Check size={10} />}
                                    <span>{pm}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Floating pending login popup */}
      {pendingLogin && (
        <div className="absolute top-full right-2 z-50 mt-1 w-[260px] rounded-lg border border-accent/30 bg-primary-bg p-3 shadow-xl">
          <div className="mb-1.5 text-text text-xs">
            <strong>{pendingLogin.agentName}</strong> installed!
          </div>
          <div className="mb-2 text-[10px] text-text-light">Login to start using this agent.</div>
          <div className="flex gap-1.5">
            <button
              onClick={() => handleLogin(pendingLogin.agentId, pendingLogin.agentName)}
              className="flex items-center gap-1 rounded bg-accent px-2 py-1 text-[10px] text-white transition-colors hover:bg-accent/80"
            >
              <LogIn size={10} />
              Login
            </button>
            <button
              onClick={handleDismissPendingLogin}
              className="rounded px-2 py-1 text-[10px] text-text-light transition-colors hover:bg-hover"
            >
              Later
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
