import { useRef, useState } from 'react';
import { Save, Upload, RotateCcw } from 'lucide-react';
import Input from '../common/Input.jsx';
import Button from '../common/Button.jsx';
import Badge from '../common/Badge.jsx';
import { inkFor } from '../../context/BrandingContext.jsx';

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const HEX = /^#[0-9a-fA-F]{6}$/;

function ImagePicker({ kind, label, hint, currentUrl, custom, maxKb, busy, onUpload, onReset }) {
  const input = useRef(null);
  const [problem, setProblem] = useState('');
  const pick = (file) => {
    if (!file) return;
    if (!IMAGE_TYPES.includes(file.type)) return setProblem('Use a PNG, JPEG or WebP image (SVG is not accepted).');
    if (file.size > maxKb * 1024) return setProblem(`The file is larger than ${maxKb} KB.`);
    setProblem('');
    onUpload(kind, file);
    return undefined;
  };
  return (
    <div className="iv-field">
      <span className="iv-field__label">
        {label} {custom ? <Badge tone="accent">Custom</Badge> : <Badge>Default</Badge>}
      </span>
      <div className="iv-brand-image">
        <div className={`iv-brand-image__preview iv-brand-image__preview--${kind}`}>
          <img src={currentUrl} alt={`Current ${label.toLowerCase()}`} />
        </div>
        <div className="d-flex flex-column gap-2 min-w-0">
          <span className="small iv-muted">{hint}</span>
          <div className="d-flex gap-2 flex-wrap">
            <Button variant="secondary" size="sm" icon={Upload} onClick={() => input.current?.click()} loading={busy === kind}>
              Upload
            </Button>
            {custom && (
              <Button variant="ghost" size="sm" icon={RotateCcw} onClick={() => onReset(kind)} disabled={Boolean(busy)}>
                Use default
              </Button>
            )}
          </div>
          <input
            ref={input}
            type="file"
            accept={IMAGE_TYPES.join(',')}
            className="visually-hidden"
            aria-label={`Upload ${label.toLowerCase()}`}
            onChange={(event) => {
              pick(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
          {problem && (
            <span className="iv-field__error" role="alert">
              {problem}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** Name, tagline, accent colour, logo and favicon, with a live preview. */
export default function BrandingForm({ value, onChange, onSubmit, saving, images, busyImage, onUpload, onResetImage }) {
  const set = (field) => (event) => onChange({ ...value, [field]: event.target.value });
  const validAccent = HEX.test(value.accentColor || '');
  const accent = validAccent ? value.accentColor : '#ffffff';

  return (
    <form
      className="d-flex flex-column gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      noValidate
    >
      <div className="iv-form-grid iv-form-grid--2">
        <Input label="App name" value={value.appName} onChange={set('appName')} maxLength={40} required hint="Shown in the browser tab, the header, emails and AI apps." />
        <Input label="Tagline" value={value.tagline} onChange={set('tagline')} maxLength={120} />
      </div>

      <div className="iv-field">
        <label className="iv-field__label" htmlFor="brand-accent">
          Accent colour
        </label>
        <div className="d-flex align-items-center gap-2">
          <input
            id="brand-accent"
            type="color"
            className="iv-color-input"
            value={accent}
            onChange={(event) => onChange({ ...value, accentColor: event.target.value })}
            aria-label="Pick the accent colour"
          />
          <input
            className={`iv-input iv-input--mono ${validAccent ? '' : 'is-invalid'}`}
            style={{ maxWidth: 140 }}
            value={value.accentColor}
            onChange={set('accentColor')}
            maxLength={7}
            aria-label="Accent colour as hex"
          />
        </div>
        <span className="iv-field__hint">Used for primary buttons, switches and highlights. White keeps the default black-and-white look.</span>
        {!validAccent && <span className="iv-field__error">Use a colour like #ffffff</span>}
      </div>

      <div className="iv-form-grid iv-form-grid--2">
        <ImagePicker
          kind="logo"
          label="Logo"
          hint="PNG, JPEG or WebP, up to 2 MB, at least 32 px. Shown in the sidebar and on sign-in pages."
          currentUrl={images.logoUrl}
          custom={images.customLogo}
          maxKb={2048}
          busy={busyImage}
          onUpload={onUpload}
          onReset={onResetImage}
        />
        <ImagePicker
          kind="favicon"
          label="Favicon"
          hint="Square PNG, JPEG or WebP, up to 512 KB, 16 to 1024 px."
          currentUrl={images.faviconUrl}
          custom={images.customFavicon}
          maxKb={512}
          busy={busyImage}
          onUpload={onUpload}
          onReset={onResetImage}
        />
      </div>

      <div className="iv-brand-preview" aria-label="Preview">
        <span className="iv-field__label">Preview</span>
        <div className="iv-brand-preview__frame">
          <img src={images.logoUrl} alt="" className="iv-brand-preview__logo" />
          <div className="min-w-0">
            <strong className="d-block iv-truncate">{value.appName || 'App name'}</strong>
            <span className="small iv-muted iv-truncate d-block">{value.tagline}</span>
          </div>
          <span className="iv-brand-preview__button" style={{ background: accent, color: inkFor(accent) }}>
            Primary action
          </span>
        </div>
      </div>

      <div className="d-flex justify-content-end">
        <Button type="submit" icon={Save} loading={saving} disabled={!validAccent || !value.appName?.trim()}>
          Save branding
        </Button>
      </div>
    </form>
  );
}
