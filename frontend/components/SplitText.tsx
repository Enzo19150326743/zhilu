"use client";

import { useEffect, useRef, useState, type CSSProperties, type ElementType } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText as GSAPSplitText } from "gsap/SplitText";
import { useGSAP } from "@gsap/react";
import "./SplitText.css";

gsap.registerPlugin(ScrollTrigger, GSAPSplitText, useGSAP);

export interface SplitTextProps {
  text: string;
  className?: string;
  delay?: number;
  duration?: number;
  ease?: string | ((progress: number) => number);
  splitType?: "chars" | "words" | "lines" | "words, chars";
  from?: gsap.TweenVars;
  to?: gsap.TweenVars;
  threshold?: number;
  rootMargin?: string;
  startDelay?: number;
  tag?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "p" | "span";
  textAlign?: CSSProperties["textAlign"];
  onLetterAnimationComplete?: () => void;
}

export default function SplitText({
  text,
  className = "",
  delay = 50,
  duration = 1.25,
  ease = "power3.out",
  splitType = "chars",
  from = { opacity: 0, y: 40 },
  to = { opacity: 1, y: 0 },
  threshold = 0.1,
  rootMargin = "-100px",
  startDelay = 0,
  textAlign = "center",
  tag = "p",
  onLetterAnimationComplete
}: SplitTextProps) {
  const ref = useRef<HTMLElement>(null);
  const animationCompletedRef = useRef(false);
  const onCompleteRef = useRef(onLetterAnimationComplete);
  const [fontsLoaded, setFontsLoaded] = useState(false);

  useEffect(() => {
    onCompleteRef.current = onLetterAnimationComplete;
  }, [onLetterAnimationComplete]);

  useEffect(() => {
    if (document.fonts.status === "loaded") {
      setFontsLoaded(true);
      return;
    }

    void document.fonts.ready.then(() => setFontsLoaded(true));
  }, []);

  useGSAP(
    () => {
      if (!ref.current || !text || !fontsLoaded || animationCompletedRef.current) {
        return;
      }

      const element = ref.current as HTMLElement & {
        _splitTextInstance?: GSAPSplitText;
      };
      const marginMatch = /^(-?\d+(?:\.\d+)?)(px|em|rem|%)?$/.exec(rootMargin);
      const marginValue = marginMatch ? Number.parseFloat(marginMatch[1]) : 0;
      const marginUnit = marginMatch?.[2] || "px";
      const marginOffset =
        marginValue === 0
          ? ""
          : marginValue < 0
            ? `-=${Math.abs(marginValue)}${marginUnit}`
            : `+=${marginValue}${marginUnit}`;
      const start = `top ${(1 - threshold) * 100}%${marginOffset}`;

      element._splitTextInstance?.revert();

      const splitInstance = new GSAPSplitText(element, {
        type: splitType,
        smartWrap: true,
        autoSplit: splitType === "lines",
        linesClass: "split-line",
        wordsClass: "split-word",
        charsClass: "split-char",
        reduceWhiteSpace: false,
        onSplit: (self) => {
          const targets = splitType.includes("chars")
            ? self.chars
            : splitType.includes("words")
              ? self.words
              : self.lines;

          if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            animationCompletedRef.current = true;
            gsap.set(element, { visibility: "visible" });
            onCompleteRef.current?.();
            return gsap.set(targets, { clearProps: "all" });
          }

          const tween = gsap.fromTo(
            targets,
            { ...from },
            {
              ...to,
              delay: startDelay,
              duration,
              ease,
              stagger: delay / 1000,
              scrollTrigger: {
                trigger: element,
                start,
                once: true,
                fastScrollEnd: true,
                anticipatePin: 0.4
              },
              force3D: true,
              willChange: "transform, opacity",
              onComplete: () => {
                animationCompletedRef.current = true;
                onCompleteRef.current?.();
              }
            }
          );
          gsap.set(element, { visibility: "visible" });
          return tween;
        }
      });

      element._splitTextInstance = splitInstance;

      return () => {
        ScrollTrigger.getAll().forEach((scrollTrigger) => {
          if (scrollTrigger.trigger === element) {
            scrollTrigger.kill();
          }
        });
        splitInstance.revert();
        element._splitTextInstance = undefined;
      };
    },
    {
      dependencies: [
        text,
        delay,
        duration,
        ease,
        splitType,
        JSON.stringify(from),
        JSON.stringify(to),
        threshold,
        rootMargin,
        startDelay,
        fontsLoaded
      ],
      scope: ref,
      revertOnUpdate: true
    }
  );

  const Tag = (tag || "p") as ElementType;

  return (
    <Tag
      className={`split-parent ${className}`}
      ref={ref}
      style={{ textAlign }}
    >
      {text}
    </Tag>
  );
}
