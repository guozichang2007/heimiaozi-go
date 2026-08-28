/** 黑喵子头像：优先显示 public/avatar.png，加载失败自动回退 emoji */
export function CatAvatar({ size = 36, className = '' }: { size?: number; className?: string }) {
  return (
    <span className={`avatar-shell ${className}`} style={{ width: size, height: size }}>
      <span className="avatar-fallback" style={{ fontSize: Math.round(size * 0.8) }}>
        🐱
      </span>
      <img
        src="/avatar.png"
        alt="黑喵子"
        className="avatar-img"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
        }}
      />
    </span>
  );
}