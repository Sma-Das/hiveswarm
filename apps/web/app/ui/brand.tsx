export function HiveMark({ small = false }: { small?: boolean }) {
  return (
    <span className={small ? "hive-mark hive-mark--small" : "hive-mark"} aria-hidden="true">
      <svg viewBox="0 0 40 40" focusable="false">
        <path d="M20 2.5 35 11v18L20 37.5 5 29V11L20 2.5Z" />
        <path d="m12.4 14.7 7.6-4.3 7.6 4.3v8.7L20 27.7l-7.6-4.3v-8.7Z" />
        <path d="m20 27.7 7.6 4.4M12.4 23.4l-7.4 4.3M20 10.4V2.5" />
      </svg>
    </span>
  );
}
