import { useBranding } from '../../hooks/useBranding.js';

/**
 * The brand in a header. With the built-in branding this is the full
 * wordmark image (it already contains the name); with an admin-set logo or
 * name it is that logo next to the name. `base` is the BEM block whose
 * __logo and __name classes size the custom variant.
 */
export default function BrandMark({ base }) {
  const { appName, logoUrl, wordmarkUrl } = useBranding();
  if (wordmarkUrl) return <img src={wordmarkUrl} alt={appName} className={`iv-wordmark ${base}__wordmark`} />;
  return (
    <>
      <img src={logoUrl} alt="" className={`${base}__logo`} />
      <span className={`${base}__name`}>{appName}</span>
    </>
  );
}
