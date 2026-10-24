import React, { useState } from 'react';
import {
  Image as ImageIcon,
  AlertCircle,
  Key,
  Download,
  X,
  Maximize2,
} from 'lucide-react';
import { ProviderSummary } from '../types';

interface ImagesTabProps {
  providers: ProviderSummary[];
  onNavigateToSettings: () => void;
}

interface GeneratedImageItem {
  id: string;
  prompt: string;
  aspectRatio: string;
  provider: string;
  timestampMillis: number;
  dataUrl?: string;
  url?: string;
}

export const ImagesTab: React.FC<ImagesTabProps> = ({
  providers,
  onNavigateToSettings,
}) => {
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState<'1:1' | '16:9' | '9:16' | '4:3'>('1:1');
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [gallery, setGallery] = useState<GeneratedImageItem[]>([]);
  const [selectedImage, setSelectedImage] = useState<GeneratedImageItem | null>(null);

  // Check if any configured provider supports image generation
  const geminiProvider = providers.find((p) => p.id === 'gemini-server');
  const openaiProvider = providers.find((p) => p.id === 'openai');
  const hasImageProvider = Boolean(
    (geminiProvider && geminiProvider.connected) ||
    (openaiProvider && openaiProvider.connected)
  );

  const handleGenerate = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!prompt.trim() || generating) return;

    if (!hasImageProvider) {
      setGenerationError(
        'No image generation provider is currently configured. Please configure an API key for Gemini (Imagen 3) or OpenAI (DALL-E 3) in Settings.'
      );
      return;
    }

    setGenerating(true);
    setGenerationError(null);

    try {
      const res = await fetch('/api/images/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt.trim(),
          aspectRatio,
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || 'Failed to generate image from provider.');
      }

      const newItem: GeneratedImageItem = {
        id: `img-${Date.now()}`,
        prompt: prompt.trim(),
        aspectRatio,
        provider: data.provider || 'Gemini Imagen 3',
        timestampMillis: Date.now(),
        dataUrl: data.imageUrl,
        url: data.url,
      };

      setGallery((prev) => [newItem, ...prev]);
      setSelectedImage(newItem);
      setPrompt('');
    } catch (err) {
      setGenerationError(
        err instanceof Error
          ? err.message
          : 'Image generation service returned an unexpected error.'
      );
    } finally {
      setGenerating(false);
    }
  };

  const handleDownload = (item: GeneratedImageItem) => {
    if (!item.dataUrl) return;
    const a = document.createElement('a');
    a.href = item.dataUrl;
    a.download = `obsidian-image-${item.id}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="flex flex-col h-full w-full max-w-full overflow-hidden bg-[#0D1117] text-[#F0F6FC]">
      {/* Top Header - Mobile Adaptive */}
      <div className="px-4 sm:px-8 py-3 sm:py-4 border-b border-[#30363D] bg-[#161B22] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shrink-0">
        <div>
          <h1 className="text-base sm:text-lg font-bold tracking-tight text-[#F0F6FC]">
            Creative Studio & Vision
          </h1>
          <p className="text-xs text-[#8B949E]">
            Generate visual concepts and interface mockups using real multimodal models.
          </p>
        </div>
        <button
          onClick={onNavigateToSettings}
          title="Configure provider keys in Settings"
          aria-label="Configure provider keys"
          className="w-full sm:w-auto min-h-[36px] px-3.5 py-1.5 rounded-lg bg-[#21262D] hover:bg-[#30363D] border border-[#30363D] text-xs text-[#C7FF65] flex items-center justify-center gap-1.5 transition-colors"
        >
          <Key className="w-3.5 h-3.5" />
          <span>Configure Provider Keys</span>
        </button>
      </div>

      {/* Main Studio Body */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-8 py-4 sm:py-6 space-y-4 sm:space-y-6 max-w-5xl mx-auto w-full">
        {/* Provider Status Check */}
        {!hasImageProvider && (
          <div className="p-4 sm:p-5 rounded-xl bg-[#161B22] border border-[#30363D] space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-[#F4C46A]">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>Image Generation Provider Not Active</span>
            </div>
            <p className="text-xs text-[#8B949E] leading-relaxed max-w-2xl">
              OBSIDIAN connects directly to official multimodal image generation backends (such as Google Gemini Imagen 3 or OpenAI DALL-E 3). Add your provider API key in the credentials vault to enable visual synthesis.
            </p>
            <div className="pt-1 flex items-center gap-3">
              <button
                onClick={onNavigateToSettings}
                title="Open Settings to configure API keys"
                aria-label="Open Settings to configure API keys"
                className="min-h-[38px] px-4 py-2 rounded-xl bg-[#C7FF65] text-[#0D1117] font-bold text-xs flex items-center gap-1.5 transition-colors"
              >
                <Key className="w-3.5 h-3.5" />
                <span>Open Settings & Credentials</span>
              </button>
            </div>
          </div>
        )}

        {/* Generation Prompt Box */}
        <div className="p-4 sm:p-5 rounded-xl bg-[#161B22] border border-[#30363D] space-y-3.5 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#F0F6FC]">
              <ImageIcon className="w-4 h-4 text-[#C7FF65]" />
              <span>Prompt Composer</span>
            </div>

            {/* Aspect Ratio Selector Pills */}
            <div className="flex items-center gap-1.5 text-xs overflow-x-auto max-w-full">
              <span className="text-[#8B949E] mr-1 text-[11px] shrink-0">Aspect Ratio:</span>
              {(['1:1', '16:9', '9:16', '4:3'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setAspectRatio(r)}
                  title={`Set aspect ratio to ${r}`}
                  aria-label={`Aspect ratio ${r}`}
                  className={`min-h-[32px] px-2.5 py-1 rounded-lg text-xs font-mono transition-colors border ${
                    aspectRatio === r
                      ? 'bg-[#21262D] text-[#C7FF65] border-[#C7FF65] font-bold shadow-sm'
                      : 'bg-[#161B22] text-[#8B949E] border-[#30363D] hover:text-[#F0F6FC]'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          <form onSubmit={handleGenerate} className="space-y-3">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              placeholder="Describe the image, composition, visual style, lighting, or architectural concept you want to create..."
              aria-label="Image generation prompt"
              className="w-full p-3 sm:p-3.5 rounded-xl bg-[#0D1117] border border-[#30363D] text-xs sm:text-sm text-[#F0F6FC] placeholder-[#8B949E] focus:outline-none focus:border-[#C7FF65] resize-none leading-relaxed"
            />

            {generationError && (
              <div className="p-3 rounded-xl bg-[#DA3633]/15 border border-[#DA3633]/40 text-xs text-[#FF727A] flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{generationError}</span>
              </div>
            )}

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
              <div className="text-[11px] text-[#8B949E]">
                Active Engine:{' '}
                <span className="text-[#F0F6FC] font-mono">Gemini Imagen 3 / Multimodal</span>
              </div>
              <button
                type="submit"
                disabled={!prompt.trim() || generating}
                title={generating ? 'Synthesizing image with multimodal AI' : 'Generate image from prompt'}
                aria-label={generating ? 'Synthesizing image' : 'Generate image'}
                className="w-full sm:w-auto min-h-[42px] px-5 py-2 rounded-xl bg-[#C7FF65] text-[#0D1117] font-bold text-xs flex items-center justify-center gap-2 hover:bg-[#B8F558] disabled:opacity-40 transition-all shadow-md cursor-pointer"
              >
                <ImageIcon className="w-4 h-4" />
                <span>{generating ? 'Synthesizing Image...' : 'Generate Image'}</span>
              </button>
            </div>
          </form>
        </div>

        {/* Generated Image Gallery */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-[#F0F6FC]">Generation Gallery</h2>
            <span className="text-xs font-mono text-[#8B949E] tabular-nums">
              {gallery.length} {gallery.length === 1 ? 'image' : 'images'} generated
            </span>
          </div>

          {gallery.length === 0 ? (
            <div className="p-8 rounded-xl bg-[#161B22] border border-[#30363D] text-center space-y-2">
              <ImageIcon className="w-8 h-8 text-[#8B949E] mx-auto opacity-50" />
              <p className="text-sm text-[#8B949E]">No images generated in this session yet.</p>
              <p className="text-xs text-[#6E7580]">
                Enter a visual prompt above to synthesize high-resolution assets with connected providers.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
              {gallery.map((item) => (
                <div
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedImage(item)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedImage(item);
                    }
                  }}
                  title={`View image: ${item.prompt}`}
                  aria-label={`View image: ${item.prompt}`}
                  className="group relative rounded-xl overflow-hidden border border-[#30363D] bg-[#161B22] hover:border-[#C7FF65]/60 cursor-pointer transition-all space-y-2 p-2 focus:outline-none focus:ring-1 focus:ring-[#C7FF65]"
                >
                  <div className="aspect-square w-full rounded-lg bg-[#0D1117] flex items-center justify-center overflow-hidden relative">
                    {item.dataUrl ? (
                      <img
                        src={item.dataUrl}
                        alt={item.prompt}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <ImageIcon className="w-8 h-8 text-[#8B949E]" />
                    )}
                    <div className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 text-[#F0F6FC] opacity-0 group-hover:opacity-100 transition-opacity">
                      <Maximize2 className="w-3.5 h-3.5" />
                    </div>
                  </div>
                  <div className="px-1.5 pb-1">
                    <p className="text-xs text-[#F0F6FC] font-medium truncate">{item.prompt}</p>
                    <p className="text-[10px] font-mono text-[#8B949E]">
                      {item.aspectRatio} · {new Date(item.timestampMillis).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Image Preview Modal (Mobile-friendly Bottom Sheet / Dialog) */}
      {selectedImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
          role="dialog"
          aria-modal="true"
        >
          <div
            className="fixed inset-0 bg-black/75 backdrop-blur-md"
            onClick={() => setSelectedImage(null)}
          />
          <div className="relative w-full max-w-2xl bg-[#161B22] border border-[#30363D] rounded-2xl shadow-2xl p-4 sm:p-6 z-10 flex flex-col space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between gap-3 border-b border-[#30363D] pb-3">
              <span className="text-xs sm:text-sm font-semibold text-[#F0F6FC] truncate">
                {selectedImage.prompt}
              </span>
              <button
                onClick={() => setSelectedImage(null)}
                title="Close image preview"
                aria-label="Close image preview"
                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-[#8B949E] hover:text-[#F0F6FC] hover:bg-[#21262D]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="w-full rounded-xl bg-[#0D1117] flex items-center justify-center overflow-hidden max-h-[60vh]">
              {selectedImage.dataUrl ? (
                <img
                  src={selectedImage.dataUrl}
                  alt={selectedImage.prompt}
                  className="max-h-[60vh] w-auto object-contain rounded-lg"
                />
              ) : (
                <ImageIcon className="w-16 h-16 text-[#8B949E]" />
              )}
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
              <div className="text-xs text-[#8B949E] font-mono">
                Engine: <span className="text-[#F0F6FC]">{selectedImage.provider}</span> · {selectedImage.aspectRatio}
              </div>
              <button
                onClick={() => handleDownload(selectedImage)}
                title="Download generated image to device"
                aria-label="Download image"
                className="min-h-[38px] px-4 py-1.5 rounded-xl bg-[#C7FF65] text-[#0D1117] font-bold text-xs flex items-center justify-center gap-2 hover:bg-[#B8F558] transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Asset</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
