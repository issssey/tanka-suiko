import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAccountActions } from "../lib/account";
import { logout, useAuth } from "../lib/auth";
import { useSettings, type Settings } from "../lib/settings";
import { ConfirmDialog, TopBar } from "../components/ui";
import { DeleteAccountText, ExportDialog } from "../components/account";

export default function SettingsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [settings, update] = useSettings();
  const [confirm, setConfirm] = useState(false);
  const [confirmExport, setConfirmExport] = useState(false);
  const { busy, error, exportAll, removeAccount: remove } = useAccountActions();
  const removeAccount = () => remove().catch(() => setConfirm(false));

  const provider = "Googleでログイン中";

  function Choice<K extends "defaultStyle" | "defaultOrthography">({ k, options }: { k: K; options: { v: Settings[K]; l: string }[] }) {
    return (
      <div className="segmented" role="group">
        {options.map((o) => (
          <button key={String(o.v)} type="button" aria-pressed={settings[k] === o.v} onClick={() => update({ [k]: o.v } as Partial<Settings>)}>
            {o.l}
          </button>
        ))}
      </div>
    );
  }

  return (
    <>
      <TopBar back="/" backLabel="一覧に戻る" title="設定" />

      <h2 className="group-title">アカウント</h2>
      <div className="card" style={{ margin: "0 16px", padding: "4px 16px" }}>
        <div className="toggle-row">
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span style={{ fontSize: 14, fontWeight: 500 }}>{user?.displayName || user?.email || "—"}</span>
            <span className="small muted" style={{ overflowWrap: "anywhere" }}>{user?.email} · {provider}</span>
          </div>
          <button type="button" className="pill" onClick={() => logout().then(() => navigate("/login"))}>ログアウト</button>
        </div>
      </div>

      <h2 className="group-title">新しい短歌の既定</h2>
      <div className="card" style={{ margin: "0 16px", padding: "4px 16px" }}>
        <div className="toggle-row">
          <span style={{ fontSize: 14 }}>文体</span>
          <Choice k="defaultStyle" options={[{ v: "auto", l: "自動" }, { v: "colloquial", l: "口語" }, { v: "literary", l: "文語" }]} />
        </div>
        <div className="toggle-row">
          <span style={{ fontSize: 14 }}>仮名遣い</span>
          <Choice k="defaultOrthography" options={[{ v: "auto", l: "自動" }, { v: "modern", l: "新" }, { v: "historical", l: "旧" }]} />
        </div>
      </div>

      <h2 className="group-title">指摘の表示</h2>
      <div className="card" style={{ margin: "0 16px", padding: "4px 16px" }}>
        <label className="toggle-row">
          <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 14 }}>重大度「低」も表示する</span>
            <span className="small muted">句またがりや「の」の連続など</span>
          </span>
          <input type="checkbox" checked={settings.showLow} onChange={(e) => update({ showLow: e.target.checked })} />
        </label>
        <label className="toggle-row">
          <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 14 }}>確からしさが低い指摘も表示する</span>
            <span className="small muted">誤検出が増えることがあります</span>
          </span>
          <input type="checkbox" checked={settings.showLowConfidence} onChange={(e) => update({ showLowConfidence: e.target.checked })} />
        </label>
      </div>

      <h2 className="group-title">ヘルプ</h2>
      <div className="card" style={{ margin: "0 16px", padding: "4px 16px" }}>
        <Link to="/patterns" className="toggle-row" style={{ textDecoration: "none", color: "var(--text)", fontSize: 14 }}>
          指摘されるパターン一覧 <span aria-hidden="true">›</span>
        </Link>
      </div>

      <h2 className="group-title">データ</h2>
      <div className="card" style={{ margin: "0 16px", padding: 0, overflow: "hidden" }}>
        <button type="button" className="list-btn" disabled={busy !== null} onClick={() => setConfirmExport(true)}>すべてのデータを書き出す</button>
        <button type="button" className="list-btn danger" disabled={busy !== null} onClick={() => setConfirm(true)}>アカウントを削除</button>
      </div>
      <div style={{ height: 32 }} />
      {error && <p className="error" style={{ marginBottom: 32 }}>{error}</p>}
      {confirmExport && (
        <ExportDialog busy={busy === "export"} onConfirm={() => exportAll().finally(() => setConfirmExport(false))} onCancel={() => setConfirmExport(false)} />
      )}
      {confirm && (
        <ConfirmDialog
          title="アカウントを削除しますか？"
          confirmLabel="アカウントとすべての短歌を削除する"
          busy={busy === "delete"}
          onConfirm={removeAccount}
          onCancel={() => setConfirm(false)}
        >
          <DeleteAccountText />
        </ConfirmDialog>
      )}
    </>
  );
}
