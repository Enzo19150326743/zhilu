import { Link, Loader2 } from "lucide-react";
import styles from "./MediaUrlForm.module.css";

interface MediaUrlFormProps {
  isSubmitting: boolean;
  value: string;
  size?: "default" | "large";
  onAnalyze: () => void;
  onChange: (value: string) => void;
}

export function MediaUrlForm({
  isSubmitting,
  value,
  size = "default",
  onAnalyze,
  onChange
}: MediaUrlFormProps) {
  return (
    <form
      className={styles.form}
      data-size={size}
      onSubmit={(event) => {
        event.preventDefault();
        if (!isSubmitting && value.trim()) onAnalyze();
      }}
    >
      <label className={styles.field}>
        <span className="sr-only">公开媒体链接</span>
        <Link aria-hidden="true" className={styles.icon} />
        <input
          className={styles.input}
          inputMode="url"
          type="text"
          value={value}
          placeholder="粘贴 B 站、小红书、小宇宙或抖音公开链接"
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      <button
        className={styles.submit}
        disabled={isSubmitting || !value.trim()}
        type="submit"
      >
        {isSubmitting ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
        {isSubmitting ? "提交中" : "提炼内容"}
      </button>
    </form>
  );
}
