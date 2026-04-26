import { pickIncusApiUrl, pickIncusUiUrl } from '../lib/utils';

type LinkSource = {
  links?: { ui_url?: string | null; api_url?: string | null } | null;
  url?: string | null;
  endpoint?: string | null;
};

export function IncusLinks({ item, label = 'Incus UI' }: { item: LinkSource; label?: string }) {
  const ui = pickIncusUiUrl(item);
  const apiUrl = pickIncusApiUrl(item);
  if (!ui && !apiUrl) return <span className="badge">not available</span>;
  return (
    <div className="row-actions">
      {ui ? (
        <a className="button secondary small" target="_blank" rel="noreferrer" href={ui}>
          {label}
        </a>
      ) : null}
      {apiUrl ? (
        <a className="button ghost small" target="_blank" rel="noreferrer" href={apiUrl}>
          API
        </a>
      ) : null}
    </div>
  );
}
