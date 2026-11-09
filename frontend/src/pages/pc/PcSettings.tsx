// PC版の設定。左の目次から各節へ移る。パターン一覧は表で出す。
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAccountActions } from "../../lib/account";
import { logout, useAuth } from "../../lib/auth";
import { useSettings } from "../../lib/settings";
import { PcHeader } from "../../components/pc";
import { PatternList } from "../../components/PatternList";
import { ConfirmDialog } from "../../components/ui";
import { DeleteAccountText, EXPORT_NOTE } from "../../components/account";

const SECTIONS = [
  { id: "account", label: "アカウント" },
  { id: "defaults", label: "新しい短歌の既定" },
  { id: "display", label: "指摘の表示" },
  { id: "patterns", label: "パターン一覧" },
  { id: "data", label: "データ" },
];

export default function PcSettings() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [settings, update] = useSettings();
  const [confirm, setConfirm] = useState(false);
  const account = useAccountActions();
  const provider = "Googleでログイン中";

  // /patterns や #patterns で来たときは、その節を表示する
  useEffect(() => {
    const id = location.pathname === "/patterns" ? "patterns" : location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView();
  }, [location]);

  const radios = (name: "defaultStyle" | "defaultOrthography", options: { v: string; l: string }[]) => (
    <div role="radiogroup" style={{ display: "flex", gap: 16 }}>
      {options.map((o) => (
        <label key={o.v} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, cursor: "pointer" }}>
          <input type="radio" name={name} checked={settings[name] === o.v} onChange={() => update({ [name]: o.v } as never)} style={{ accentColor: "var(--accent)" }} />
          {o.l}
        </label>
      ))}
    </div>
  );

  return (
    <div className="pc">
      <PcHeader />
      <div className="pc-settings">
        <nav className="pc-toc" aria-label="設定の目次">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`}>{s.label}</a>
          ))}
        </nav>
        <div>
          <h1 style={{ margin: 0, fontSize: 26 }}>設定</h1>

          <section id="account">
            <h2>アカウント</h2>
            <div className="card" style={{ padding: "4px 20px" }}>
              <div className="toggle-row">
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: 15, fontWeight: 500 }}>{user?.displayName || user?.email || "—"}</span>
                  <span className="small muted">{user?.email} · {provider}</span>
                </div>
                <button type="button" className="pc-btn" onClick={() => logout().then(() => navigate("/login"))}>ログアウト</button>
              </div>
            </div>
          </section>

          <section id="defaults">
            <h2>新しい短歌の既定</h2>
            <div className="card" style={{ padding: "4px 20px" }}>
              <div className="toggle-row"><span style={{ fontSize: 14 }}>文体</span>{radios("defaultStyle", [{ v: "auto", l: "自動" }, { v: "colloquial", l: "口語" }, { v: "literary", l: "文語" }])}</div>
              <div className="toggle-row"><span style={{ fontSize: 14 }}>仮名遣い</span>{radios("defaultOrthography", [{ v: "auto", l: "自動" }, { v: "modern", l: "新仮名" }, { v: "historical", l: "旧仮名" }])}</div>
            </div>
          </section>

          <section id="display">
            <h2>指摘の表示</h2>
            <div className="card" style={{ padding: "4px 20px" }}>
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
          </section>

          <section id="patterns">
            <h2>指摘されるパターン一覧</h2>
            <PatternList wide />
          </section>

          <section id="data">
            <h2>データ</h2>
            <p className="muted" style={{ margin: "0 0 12px", fontSize: 13, lineHeight: 1.7 }}>{EXPORT_NOTE}</p>
            <div className="card" style={{ display: "flex", gap: 12, flexWrap: "wrap", padding: "18px 20px" }}>
              <button type="button" className="pc-btn" disabled={account.busy !== null} onClick={account.exportAll}>すべてのデータを書き出す</button>
              <button type="button" className="pc-btn danger" disabled={account.busy !== null} onClick={() => setConfirm(true)}>アカウントを削除</button>
            </div>
            {account.error && <p className="error" style={{ margin: "12px 0 0" }}>{account.error}</p>}
          </section>
        </div>
      </div>
      {confirm && (
        <ConfirmDialog
          title="アカウントを削除しますか？"
          confirmLabel="アカウントとすべての短歌を削除する"
          busy={account.busy === "delete"}
          onConfirm={() => account.removeAccount().catch(() => setConfirm(false))}
          onCancel={() => setConfirm(false)}
        >
          <DeleteAccountText />
        </ConfirmDialog>
      )}
    </div>
  );
}
