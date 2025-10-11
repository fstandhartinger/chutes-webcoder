"use client";

import { useState } from "react";
import Link from "next/link";
import { appConfig } from "@/config/app.config";

interface SidebarInputProps {
  onSubmit: (url: string, style: string, model: string, instructions?: string) => void;
  disabled?: boolean;
}

export default function SidebarInput({ onSubmit, disabled = false }: SidebarInputProps) {
  const [url, setUrl] = useState<string>("");
  const [selectedStyle, setSelectedStyle] = useState<string>("1");
  const [selectedModel, setSelectedModel] = useState<string>(appConfig.ai.defaultModel);
  const [additionalInstructions, setAdditionalInstructions] = useState<string>("");
  const [isValidUrl, setIsValidUrl] = useState<boolean>(false);

  // Simple URL validation - currently unused but keeping for future use
  // const validateUrl = (urlString: string) => {
  //   if (!urlString) return false;
  //   const urlPattern = /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/;
  //   return urlPattern.test(urlString.toLowerCase());
  // };

  const styles = [
    { id: "1", name: "Glassmorphism", description: "Frosted glass effect" },
    { id: "2", name: "Neumorphism", description: "Soft 3D shadows" },
    { id: "3", name: "Brutalism", description: "Bold and raw" },
    { id: "4", name: "Minimalist", description: "Clean and simple" },
    { id: "5", name: "Dark Mode", description: "Dark theme design" },
    { id: "6", name: "Gradient Rich", description: "Vibrant gradients" },
    { id: "7", name: "3D Depth", description: "Dimensional layers" },
    { id: "8", name: "Retro Wave", description: "80s inspired" },
  ];

  const models = appConfig.ai.availableModels.map((model) => ({
    id: model,
    name: appConfig.ai.modelDisplayNames?.[model] || model,
  }));

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!url.trim() || disabled) return;

    onSubmit(url.trim(), selectedStyle, selectedModel, additionalInstructions || undefined);

    // Reset form
    setUrl("");
    setAdditionalInstructions("");
    setIsValidUrl(false);
  };

  return (
    <div className="w-full">
      <div >
        <div className="p-4 border-b border-surface-ink-600/70">
         {/* link to home page with button */}
         <Link href="/">
          <button className="w-full px-4 py-2 text-xs font-medium text-ink-100 bg-surface-ink-850/90 rounded-lg border border-surface-ink-600/70 transition-all focus:outline-none focus:ring-2 focus:ring-moss-400/60 focus:border-moss-400 hover:border-moss-400 hover:text-ink-50">
            Generate a new website
          </button>
         </Link>
        </div>

        {/* Options Section - Show when valid URL */}
        {isValidUrl && (
          <div className="p-4 space-y-4">
            {/* Style Selector */}
            <div>
              <label className="block text-xs font-medium text-ink-300 mb-2">Style</label>
              <div className="grid grid-cols-2 gap-1.5">
                {styles.map((style) => (
                  <button
                    key={style.id}
                    onClick={() => setSelectedStyle(style.id)}
                    disabled={disabled}
                    className={`
                      py-2 px-2 rounded-lg text-xs font-medium border transition-all text-center
                      ${selectedStyle === style.id
                        ? 'border-moss-400/80 bg-surface-ink-800 text-ink-50 shadow-[var(--shadow-floating)]'
                        : 'border-surface-ink-600/60 bg-surface-ink-850/70 text-ink-300 hover:border-moss-400/60 hover:text-ink-100 hover:bg-surface-ink-800/80'
                      }
                      ${disabled ? 'opacity-40 cursor-not-allowed' : ''}
                    `}
                  >
                    {style.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Model Selector */}
            <div>
              <label className="block text-xs font-medium text-ink-300 mb-2">AI Model</label>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                disabled={disabled}
                className="w-full px-3 py-2 text-xs font-medium text-ink-100 bg-surface-ink-850/90 rounded-lg border border-surface-ink-600/70 focus:outline-none focus:ring-2 focus:ring-moss-400/60 focus:border-moss-400 transition-all disabled:opacity-40"
              >
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Additional Instructions */}
            <div>
              <label className="block text-xs font-medium text-ink-300 mb-2">Additional Instructions (optional)</label>
              <input
                type="text"
                value={additionalInstructions}
                onChange={(e) => setAdditionalInstructions(e.target.value)}
                disabled={disabled}
                className="w-full px-3 py-2 text-xs text-ink-100 bg-surface-ink-850/90 rounded-lg border border-surface-ink-600/70 focus:outline-none focus:ring-2 focus:ring-moss-400/60 focus:border-moss-400 placeholder:text-ink-500 transition-all disabled:opacity-40"
                placeholder="e.g., make it more colorful, add animations..."
              />
            </div>

            {/* Submit Button */}
            <div className="pt-2">
              <button
                onClick={handleSubmit}
                disabled={!isValidUrl || disabled}
                className={`
                  w-full py-2.5 px-4 rounded-lg text-sm font-medium transition-all
                  ${isValidUrl && !disabled
                    ? 'bg-moss-500 hover:bg-moss-400 text-surface-ink-950 shadow-[0_12px_24px_rgba(14,80,52,0.35)]'
                    : 'bg-surface-ink-800 text-ink-500 cursor-not-allowed'
                  }
                `}
              >
                {disabled ? 'Scraping...' : 'Scrape Site'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
