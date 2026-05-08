import { useState, useEffect } from 'react';

const images = [
  'https://images.unsplash.com/photo-1534067783941-51c9c23ecefd?q=80&w=2000&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1506744038136-46273834b3fb?q=80&w=2000&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1536440136628-849c177e76a1?q=80&w=2000&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1472214103451-9374bd1c798e?q=80&w=2000&auto=format&fit=crop',
];

export function BackgroundCarousel() {
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrent((prev) => (prev + 1) % images.length);
    }, 8000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="fixed inset-0 -z-10 overflow-hidden bg-[#07080d]">
      {images.map((url, i) => (
        <div
          key={url}
          className={`absolute inset-0 transition-opacity duration-[3000ms] ease-in-out ${
            i === current ? 'opacity-40 scale-100' : 'opacity-0 scale-110'
          }`}
          style={{
            backgroundImage: `url(${url})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            transform: i === current ? 'scale(1)' : 'scale(1.1)',
            transition: 'opacity 3000ms ease-in-out, transform 8000ms linear',
          }}
        />
      ))}
      <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-[#07080d]" />
    </div>
  );
}
