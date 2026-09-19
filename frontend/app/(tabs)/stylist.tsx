import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Image } from "expo-image";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import {
  ArrowsLeftRight,
  ArrowUp,
  DotsThree,
  Paperclip,
  Plus,
  Prohibit,
  ShoppingBag,
  Sparkle,
  Sun,
  ThumbsDown,
  ThumbsUp,
  UserFocus,
  X,
} from "phosphor-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, imageUri, Item, OutfitResult } from "@/src/api";
import { ItemThumb } from "@/src/components/item-thumb";
import { OccasionSheet } from "@/src/components/occasion-sheet";
import { usesNativeTabs } from "@/src/navigation";
import { consumeStylistFocus, usePendingStylistFocus } from "@/src/stylist-focus";
import { useToast } from "@/src/toast";
import { useWeather } from "@/src/weather";
import { fontSize, makeStyles, spacing, useTheme } from "@/src/theme";
import { Button } from "@/src/ui";

type ResultMsg = {
  kind: "result";
  result: OutfitResult;
  saved?: boolean;
  edited?: boolean;
  id: string;
  prompt: string;
  focusId?: string | null;
  feedback?: "up" | "down";
  vizPath?: string | null;
  vizLoading?: boolean;
};
type Msg = { kind: "user"; text: string; id: string } | ResultMsg;

const QUICK_PROMPTS = [
  "Style an office visit outfit",
  "Casual weekend look",
  "Date night in autumn",
  "Build a smart casual look",
];
const UNWORN_PROMPT = "Build a look around pieces I haven't worn yet";

export default function Stylist() {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { show } = useToast();
  const params = useLocalSearchParams<{ focusId?: string }>();

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [focus, setFocus] = useState<Item | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Which look is being edited via the item picker: swap one piece (itemId) or add a piece (itemId null).
  const [editTarget, setEditTarget] = useState<{ msgId: string; itemId: string | null } | null>(null);
  // Piece the user tapped inside a look → action sheet (swap / remove / never suggest).
  const [pieceTarget, setPieceTarget] = useState<{ msgId: string; item: Item } | null>(null);
  const [tagging, setTagging] = useState<ResultMsg | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const { weather, loading: weatherLoading, enabled: weatherEnabled, enable: enableWeather, disable: disableWeather } = useWeather();

  const { data: items } = useQuery({ queryKey: ["items", "All"], queryFn: () => api.items("All") });
  const { data: outfits } = useQuery({ queryKey: ["outfits"], queryFn: () => api.outfits() });
  const { data: insights } = useQuery({ queryKey: ["insights"], queryFn: () => api.insights() });
  const { data: profile } = useQuery({ queryKey: ["profile"], queryFn: () => api.profile() });
  const customTags = Array.from(new Set((outfits || []).map((o) => o.occasion || "").filter(Boolean)));
  const unwornCount = insights?.never_worn_count ?? 0;

  const pendingFocusId = usePendingStylistFocus();
  const focusId = pendingFocusId || params.focusId;
  useEffect(() => {
    if (focusId && items) {
      const it = items.find((i) => i.id === focusId);
      if (it) {
        setFocus(it);
        show(`Styling around ${it.name}`, "default");
      }
      if (pendingFocusId) consumeStylistFocus();
    }
  }, [focusId, pendingFocusId, items]); // eslint-disable-line react-hooks/exhaustive-deps

  const generate = useMutation({
    mutationFn: ({
      prompt,
      focusId,
      weatherLabel,
      avoidIds,
      preferUnworn,
    }: {
      prompt: string;
      focusId?: string | null;
      weatherLabel?: string | null;
      avoidIds?: string[];
      preferUnworn?: boolean;
    }) =>
      api.stylist({ prompt, focus_item_id: focusId, weather_context: weatherLabel, avoid_item_ids: avoidIds, prefer_unworn: preferUnworn }),
    onSuccess: (result, vars) => {
      setMessages((m) => [...m, { kind: "result", result, id: `${Date.now()}`, prompt: vars.prompt, focusId: vars.focusId }]);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    },
    onError: (e: any) => show(e?.message || "Stylist unavailable", "error"),
  });

  const pushUser = (text: string) => setMessages((m) => [...m, { kind: "user", text, id: `u${Date.now()}` }]);

  const send = (text: string, opts?: { preferUnworn?: boolean }) => {
    const prompt = text.trim();
    if (!prompt) return;
    pushUser(focus ? `${prompt}  ·  [${focus.name}]` : prompt);
    setInput("");
    generate.mutate({ prompt, focusId: focus?.id, weatherLabel: weather?.label, preferUnworn: opts?.preferUnworn });
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  };

  /** Re-run the SAME request as the given look, asking the stylist to avoid repeating its pieces. */
  const tryAnother = (msg: ResultMsg, label = "Try another look") => {
    if (generate.isPending) return;
    pushUser(label);
    // Avoid every combination already shown for this prompt, not just the last one.
    const seen = messages.filter((x): x is ResultMsg => x.kind === "result" && x.prompt === msg.prompt).flatMap((x) => x.result.item_ids);
    generate.mutate({
      prompt: msg.prompt,
      focusId: msg.focusId,
      weatherLabel: weather?.label,
      avoidIds: Array.from(new Set([...seen, ...msg.result.item_ids])),
      preferUnworn: msg.prompt === UNWORN_PROMPT,
    });
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const patchMsg = (msgId: string, patch: Partial<ResultMsg>) =>
    setMessages((m) => m.map((x) => (x.kind === "result" && x.id === msgId ? { ...x, ...patch } : x)));

  /** 👍 / 👎 — recorded for the stylist's taste model; a 👎 immediately fetches a different look. */
  const rate = async (msg: ResultMsg, verdict: "up" | "down") => {
    if (msg.feedback === verdict) return;
    patchMsg(msg.id, { feedback: verdict });
    try {
      await api.feedback({ verdict, item_ids: msg.result.item_ids, outfit_name: msg.result.outfit_name, prompt: msg.prompt });
      qc.invalidateQueries({ queryKey: ["taste"] });
      if (verdict === "up") show("Noted — I'll lean into this style", "success");
      else {
        show("Noted — finding you something different", "default");
        tryAnother(msg, "Not my style — show me something else");
      }
    } catch {
      patchMsg(msg.id, { feedback: undefined });
      show("Could not save feedback", "error");
    }
  };

  /** "Don't suggest this again": hides the piece from the stylist and drops it from the current look. */
  const banPiece = async (msgId: string, item: Item) => {
    try {
      await api.updateItem(item.id, { preference: "avoid" });
      qc.invalidateQueries({ queryKey: ["items"] });
      updateLook(msgId, (its) => (its.length > 1 ? its.filter((i) => i.id !== item.id) : its));
      show(`${item.name} won't be suggested again`, "success", {
        label: "Undo",
        onPress: async () => {
          await api.updateItem(item.id, { preference: "neutral" }).catch(() => {});
          qc.invalidateQueries({ queryKey: ["items"] });
        },
      });
    } catch {
      show("Could not update preference", "error");
    }
  };

  /** Nano Banana try-on: renders the look on the user's profile photo. */
  const visualize = async (msg: ResultMsg) => {
    if (!profile?.photo_path) {
      show("Add your photo in Profile first", "error", { label: "Go", onPress: () => router.push("/(tabs)/profile") });
      return;
    }
    patchMsg(msg.id, { vizLoading: true });
    try {
      const res = await api.visualize(msg.result.item_ids, msg.result.outfit_name);
      patchMsg(msg.id, { vizPath: res.storage_path, vizLoading: false });
    } catch (e: any) {
      patchMsg(msg.id, { vizLoading: false });
      show(e?.message || "Could not create the try-on image", "error");
    }
  };

  const dismiss = (msgId: string) => {
    setMessages((m) => {
      const idx = m.findIndex((x) => x.id === msgId);
      if (idx < 0) return m;
      const prev = m[idx - 1];
      // Drop the look and the request bubble that produced it.
      const start = prev && prev.kind === "user" ? idx - 1 : idx;
      return [...m.slice(0, start), ...m.slice(idx + 1)];
    });
  };

  const clearChat = () => {
    setMessages([]);
    setFocus(null);
  };

  const updateLook = (msgId: string, mutate: (items: Item[]) => Item[]) => {
    setMessages((m) =>
      m.map((x) => {
        if (x.kind !== "result" || x.id !== msgId) return x;
        const nextItems = mutate(x.result.items);
        return { ...x, saved: false, edited: true, result: { ...x.result, items: nextItems, item_ids: nextItems.map((i) => i.id) } };
      }),
    );
  };

  const removeFromLook = (msgId: string, itemId: string) => updateLook(msgId, (its) => its.filter((i) => i.id !== itemId));

  const applyPick = (it: Item) => {
    if (editTarget) {
      const { msgId, itemId } = editTarget;
      updateLook(msgId, (its) => {
        if (its.some((i) => i.id === it.id)) return its;
        if (itemId) return its.map((i) => (i.id === itemId ? it : i));
        return [...its, it];
      });
      show(itemId ? `Swapped in ${it.name}` : `Added ${it.name}`, "success");
      setEditTarget(null);
    } else {
      setFocus(it);
    }
    setPickerOpen(false);
  };

  const shop = (q: string) => {
    const url = `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(q)}`;
    Linking.openURL(url).catch(() => show("Could not open shopping", "error"));
  };

  const toggleWeather = async () => {
    if (weatherEnabled) {
      await disableWeather();
      show("Weather sync off", "default");
      return;
    }
    const w = await enableWeather();
    if (w) show(`Weather synced · ${w.label}`, "success");
    else show("Location permission needed for weather", "error");
  };

  const saveOutfit = async (msg: ResultMsg, occasion: string) => {
    try {
      await api.saveOutfit({
        title: msg.result.outfit_name,
        item_ids: msg.result.item_ids,
        stylist_note: msg.result.stylist_note,
        occasion,
      });
      setMessages((m) => m.map((x) => (x.kind === "result" && x.id === msg.id ? { ...x, saved: true } : x)));
      qc.invalidateQueries({ queryKey: ["outfits"] });
      qc.invalidateQueries({ queryKey: ["insights"] });
      show(occasion ? `Saved to lookbook · ${occasion.toUpperCase()}` : "Saved to lookbook", "success");
    } catch {
      show("Could not save outfit", "error");
    }
  };

  const weatherChipLabel = weatherLoading
    ? "SYNCING…"
    : weather
      ? weather.label
      : weatherEnabled
        ? "WEATHER UNAVAILABLE"
        : "ENABLE WEATHER";

  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const empty = messages.length === 0;

  // Picker contents depend on what we're doing: when swapping, show same-category pieces first
  // and hide pieces already in the look.
  const pickerItems = (() => {
    const all = items || [];
    if (!editTarget) return all;
    const target = messages.find((x): x is ResultMsg => x.kind === "result" && x.id === editTarget.msgId);
    if (!target) return all;
    const inLook = new Set(target.result.item_ids);
    const swapping = editTarget.itemId ? target.result.items.find((i) => i.id === editTarget.itemId) : null;
    const candidates = all.filter((i) => !inLook.has(i.id));
    if (!swapping) return candidates;
    return [...candidates.filter((i) => i.category === swapping.category), ...candidates.filter((i) => i.category !== swapping.category)];
  })();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>STYLIST</Text>
          <Text style={styles.sub}>AI-CURATED FROM YOUR CLOSET</Text>
        </View>
        <Pressable style={[styles.weatherChip, weatherEnabled && styles.weatherChipOn]} onPress={toggleWeather} testID="weather-chip">
          <Sun color={weatherEnabled ? colors.onBrandPrimary : colors.onSurface} size={16} weight="bold" />
          <Text style={[styles.weatherText, weatherEnabled && { color: colors.onBrandPrimary }]}>{weatherChipLabel}</Text>
        </Pressable>
      </View>
      <View style={styles.hairline} />

      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.lg }}
        keyboardShouldPersistTaps="handled"
      >
        {empty && (
          <View style={styles.promptsWrap}>
            {unwornCount > 0 && (
              <Pressable style={styles.nudge} onPress={() => send(UNWORN_PROMPT, { preferUnworn: true })} testID="unworn-nudge">
                <View style={styles.nudgeIcon}>
                  <Sparkle color={colors.onBrandPrimary} size={16} weight="fill" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.nudgeTitle}>
                    {unwornCount} {unwornCount === 1 ? "PIECE" : "PIECES"} NEVER WORN
                  </Text>
                  <Text style={styles.nudgeSub}>Let the stylist build a look that finally gets them out of the closet.</Text>
                </View>
                <Text style={styles.nudgeCta}>STYLE THEM →</Text>
              </Pressable>
            )}
            <Text style={styles.promptsLabel}>TRY ASKING</Text>
            {QUICK_PROMPTS.map((p) => (
              <Pressable key={p} testID={`quick-${p}`} style={styles.promptChip} onPress={() => send(p)}>
                <Text style={styles.promptChipText}>{p}</Text>
              </Pressable>
            ))}
            <Pressable style={styles.promptChip} onPress={() => setPickerOpen(true)} testID="quick-attach">
              <Text style={styles.promptChipText}>Attach an item & find matches</Text>
            </Pressable>
          </View>
        )}

        {!empty && (
          <Pressable style={styles.clearBtn} onPress={clearChat} testID="clear-chat-btn" hitSlop={6}>
            <X color={colors.onSurface} size={12} weight="bold" />
            <Text style={styles.clearText}>CLEAR CONVERSATION</Text>
          </Pressable>
        )}

        {messages.map((m) =>
          m.kind === "user" ? (
            <View key={m.id} style={styles.userMsg}>
              <Text style={styles.userText}>{m.text}</Text>
            </View>
          ) : (
            <ResultCard
              key={m.id}
              msg={m}
              busy={generate.isPending}
              canVisualize={!!profile?.photo_path}
              onSave={() => setTagging(m)}
              onRetry={() => tryAnother(m)}
              onDismiss={() => dismiss(m.id)}
              onPiece={(item) => setPieceTarget({ msgId: m.id, item })}
              onAdd={() => {
                setEditTarget({ msgId: m.id, itemId: null });
                setPickerOpen(true);
              }}
              onRate={(v) => rate(m, v)}
              onVisualize={() => visualize(m)}
              onAddMissing={() => router.push("/add-item")}
              onShop={shop}
            />
          ),
        )}

        {generate.isPending && (
          <View style={styles.typing} testID="stylist-typing">
            <ActivityIndicator color={colors.onSurface} />
            <Text style={styles.typingText}>STYLING...</Text>
          </View>
        )}
      </ScrollView>

      <KeyboardStickyView offset={{ closed: 0, opened: bottomChrome }}>
        <View style={[styles.inputBar, { paddingBottom: bottomChrome ? spacing.md : spacing.md }]}>
          {focus && (
            <View style={styles.focusPill} testID="focus-pill">
              <View style={styles.focusThumb}>
                <ItemThumb item={focus} />
              </View>
              <Text numberOfLines={1} style={styles.focusName}>
                {focus.name}
              </Text>
              <Pressable onPress={() => setFocus(null)} testID="clear-focus" hitSlop={8}>
                <X color={colors.onSurface} size={16} weight="bold" />
              </Pressable>
            </View>
          )}
          <View style={styles.inputRow}>
            <Pressable onPress={() => setPickerOpen(true)} style={styles.attachBtn} testID="attach-btn">
              <Paperclip color={colors.onSurface} size={20} />
            </Pressable>
            <TextInput
              testID="stylist-input"
              style={styles.input}
              placeholder="Describe the look you want…"
              placeholderTextColor={colors.muted}
              value={input}
              onChangeText={setInput}
              multiline
              blurOnSubmit
              returnKeyType="send"
              onSubmitEditing={() => send(input)}
            />
            <Pressable
              testID="send-btn"
              onPress={() => send(input)}
              disabled={!input.trim()}
              style={[styles.sendBtn, { opacity: input.trim() ? 1 : 0.35 }]}
            >
              <ArrowUp color={colors.onBrandPrimary} size={20} weight="bold" />
            </Pressable>
          </View>
        </View>
      </KeyboardStickyView>

      <ItemPicker
        open={pickerOpen}
        title={editTarget ? (editTarget.itemId ? "SWAP THIS PIECE" : "ADD A PIECE") : "ATTACH AN ITEM"}
        items={pickerItems}
        onClose={() => {
          setPickerOpen(false);
          setEditTarget(null);
        }}
        onPick={applyPick}
      />

      <OccasionSheet
        open={!!tagging}
        title="SAVE TO LOOKBOOK"
        confirmLabel="Save Look"
        extraTags={customTags}
        onClose={() => setTagging(null)}
        onConfirm={(occasion) => {
          const msg = tagging;
          setTagging(null);
          if (msg) saveOutfit(msg, occasion);
        }}
      />

      <PieceSheet
        target={pieceTarget}
        canRemove={(() => {
          const m = messages.find((x): x is ResultMsg => x.kind === "result" && x.id === pieceTarget?.msgId);
          return !!m && m.result.items.length > 1;
        })()}
        onClose={() => setPieceTarget(null)}
        onSwap={() => {
          if (!pieceTarget) return;
          setEditTarget({ msgId: pieceTarget.msgId, itemId: pieceTarget.item.id });
          setPieceTarget(null);
          setPickerOpen(true);
        }}
        onRemove={() => {
          if (!pieceTarget) return;
          removeFromLook(pieceTarget.msgId, pieceTarget.item.id);
          setPieceTarget(null);
        }}
        onBan={() => {
          if (!pieceTarget) return;
          banPiece(pieceTarget.msgId, pieceTarget.item);
          setPieceTarget(null);
        }}
      />
    </View>
  );
}

function ResultCard({
  msg,
  busy,
  canVisualize,
  onSave,
  onRetry,
  onDismiss,
  onPiece,
  onAdd,
  onRate,
  onVisualize,
  onAddMissing,
  onShop,
}: {
  msg: ResultMsg;
  busy: boolean;
  canVisualize: boolean;
  onSave: () => void;
  onRetry: () => void;
  onDismiss: () => void;
  onPiece: (item: Item) => void;
  onAdd: () => void;
  onRate: (verdict: "up" | "down") => void;
  onVisualize: () => void;
  onAddMissing: () => void;
  onShop: (q: string) => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const r = msg.result;
  const vizUri = msg.vizPath ? imageUri({ storage_path: msg.vizPath }) : undefined;
  return (
    <View style={styles.resultCard} testID="outfit-result">
      <View style={styles.resultHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.resultName}>{r.outfit_name.toUpperCase()}</Text>
          <Text style={styles.resultHint}>{msg.edited ? "EDITED · TAP A PIECE FOR OPTIONS" : "TAP A PIECE TO SWAP, REMOVE OR BAN IT"}</Text>
        </View>
        <Pressable onPress={onDismiss} style={styles.dismissBtn} testID="dismiss-result-btn" hitSlop={6}>
          <X color={colors.onSurface} size={18} weight="bold" />
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.compositeRow}>
        {r.items.map((it) => (
          <View key={it.id} style={styles.compositeItem}>
            <Pressable style={styles.compositeThumb} onPress={() => onPiece(it)} testID={`piece-${it.id}`}>
              <ItemThumb item={it} />
              <View style={styles.swapBadge}>
                <DotsThree color={colors.onBrandPrimary} size={14} weight="bold" />
              </View>
            </Pressable>
            <Text numberOfLines={1} style={styles.compositeLabel}>
              {it.name}
            </Text>
          </View>
        ))}
        <Pressable style={styles.addTile} onPress={onAdd} testID="add-piece-btn">
          <Plus color={colors.onSurface} size={22} weight="bold" />
          <Text style={styles.addTileText}>ADD PIECE</Text>
        </Pressable>
      </ScrollView>

      {/* Try-on visual */}
      {vizUri ? (
        <View style={styles.vizBox} testID="viz-image">
          <Image source={{ uri: vizUri }} style={styles.vizImage} contentFit="cover" transition={300} />
          <Text style={styles.vizCaption}>VISUALISED ON YOU · AI RENDER</Text>
        </View>
      ) : (
        <Pressable
          style={[styles.vizBtn, msg.vizLoading && { opacity: 0.6 }]}
          onPress={onVisualize}
          disabled={msg.vizLoading}
          testID="visualize-btn"
        >
          {msg.vizLoading ? <ActivityIndicator color={colors.onSurface} size="small" /> : <UserFocus color={colors.onSurface} size={18} weight="bold" />}
          <Text style={styles.vizBtnText}>
            {msg.vizLoading ? "DRESSING YOU… ~20 SEC" : canVisualize ? "VISUALISE ON ME" : "VISUALISE ON ME · ADD YOUR PHOTO IN PROFILE"}
          </Text>
        </Pressable>
      )}

      {!!r.stylist_note && (
        <View style={styles.noteBox}>
          <Text style={styles.noteLabel}>STYLIST NOTE</Text>
          <Text style={styles.noteText}>{r.stylist_note}</Text>
        </View>
      )}
      {!!r.missing_suggestion && (
        <Pressable style={styles.shopLink} onPress={() => onShop(r.missing_suggestion)} testID="shop-missing-btn">
          <ShoppingBag color={colors.onSurface} size={18} weight="bold" />
          <Text style={styles.shopText}>SHOP THE GAP: {r.missing_suggestion.toUpperCase()}</Text>
        </Pressable>
      )}

      {/* Feedback */}
      <View style={styles.feedbackRow}>
        <Text style={styles.feedbackLabel}>{msg.feedback ? (msg.feedback === "up" ? "YOU LIKED THIS" : "NOT YOUR STYLE — NOTED") : "RATE THIS LOOK"}</Text>
        <View style={{ flexDirection: "row", gap: spacing.xs }}>
          <Pressable
            style={[styles.thumbBtn, msg.feedback === "up" && styles.thumbBtnOn]}
            onPress={() => onRate("up")}
            testID="feedback-up-btn"
            hitSlop={4}
          >
            <ThumbsUp color={msg.feedback === "up" ? colors.onBrandPrimary : colors.onSurface} size={18} weight={msg.feedback === "up" ? "fill" : "bold"} />
          </Pressable>
          <Pressable
            style={[styles.thumbBtn, msg.feedback === "down" && styles.thumbBtnOn]}
            onPress={() => onRate("down")}
            disabled={busy}
            testID="feedback-down-btn"
            hitSlop={4}
          >
            <ThumbsDown color={msg.feedback === "down" ? colors.onBrandPrimary : colors.onSurface} size={18} weight={msg.feedback === "down" ? "fill" : "bold"} />
          </Pressable>
        </View>
      </View>

      <View style={styles.actions}>
        <Button
          title={msg.saved ? "Saved ✓" : "Save Outfit"}
          onPress={onSave}
          disabled={msg.saved}
          testID="save-outfit-btn"
          style={{ flex: 1 }}
        />
        <Button title="Try Another" variant="outline" onPress={onRetry} disabled={busy} testID="try-another-btn" style={{ flex: 1 }} />
      </View>
      <Pressable onPress={onAddMissing} style={styles.addMissing} testID="add-missing-btn">
        <Text style={styles.addMissingText}>ADD MISSING ITEM</Text>
      </Pressable>
    </View>
  );
}

function PieceSheet({
  target,
  canRemove,
  onClose,
  onSwap,
  onRemove,
  onBan,
}: {
  target: { msgId: string; item: Item } | null;
  canRemove: boolean;
  onClose: () => void;
  onSwap: () => void;
  onRemove: () => void;
  onBan: () => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const item = target?.item;
  return (
    <Modal visible={!!target} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]} testID="piece-sheet">
        <View style={styles.sheetHeader}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, flex: 1 }}>
            {item && (
              <View style={styles.pieceThumb}>
                <ItemThumb item={item} />
              </View>
            )}
            <Text style={styles.sheetTitle} numberOfLines={1}>
              {(item?.name || "").toUpperCase()}
            </Text>
          </View>
          <Pressable onPress={onClose} testID="piece-close" hitSlop={8}>
            <X color={colors.onSurface} size={22} weight="bold" />
          </Pressable>
        </View>
        <Pressable style={styles.pieceAction} onPress={onSwap} testID="piece-swap-btn">
          <ArrowsLeftRight color={colors.onSurface} size={20} weight="bold" />
          <View style={{ flex: 1 }}>
            <Text style={styles.pieceActionTitle}>SWAP FOR ANOTHER PIECE</Text>
            <Text style={styles.pieceActionSub}>Pick a replacement from your closet.</Text>
          </View>
        </Pressable>
        <Pressable style={[styles.pieceAction, !canRemove && { opacity: 0.4 }]} onPress={onRemove} disabled={!canRemove} testID="piece-remove-btn">
          <X color={colors.onSurface} size={20} weight="bold" />
          <View style={{ flex: 1 }}>
            <Text style={styles.pieceActionTitle}>REMOVE FROM THIS LOOK</Text>
            <Text style={styles.pieceActionSub}>{canRemove ? "Keep the rest of the outfit." : "A look needs at least one piece."}</Text>
          </View>
        </Pressable>
        <Pressable style={styles.pieceAction} onPress={onBan} testID="piece-ban-btn">
          <Prohibit color={colors.error} size={20} weight="bold" />
          <View style={{ flex: 1 }}>
            <Text style={[styles.pieceActionTitle, { color: colors.error }]}>DON&apos;T SUGGEST THIS AGAIN</Text>
            <Text style={styles.pieceActionSub}>The stylist will stop using this piece. You can undo in the item&apos;s page.</Text>
          </View>
        </Pressable>
      </View>
    </Modal>
  );
}

function ItemPicker({
  open,
  title,
  items,
  onClose,
  onPick,
}: {
  open: boolean;
  title: string;
  items: Item[];
  onClose: () => void;
  onPick: (it: Item) => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{title}</Text>
          <Pressable onPress={onClose} testID="picker-close" hitSlop={8}>
            <X color={colors.onSurface} size={22} weight="bold" />
          </Pressable>
        </View>
        {items.length === 0 ? (
          <Text style={styles.pickerEmpty} testID="picker-empty">
            NO OTHER PIECES AVAILABLE — ADD MORE TO YOUR CLOSET
          </Text>
        ) : (
          <FlatList
            data={items}
            keyExtractor={(i) => i.id}
            numColumns={3}
            contentContainerStyle={{ paddingBottom: spacing.lg }}
            renderItem={({ item }) => (
              <Pressable style={styles.pickerCell} onPress={() => onPick(item)} testID={`pick-${item.id}`}>
                <View style={styles.pickerThumb}>
                  <ItemThumb item={item} />
                </View>
                <Text numberOfLines={1} style={styles.pickerLabel}>
                  {item.name}
                </Text>
                <Text numberOfLines={1} style={styles.pickerCat}>
                  {item.category.toUpperCase()}
                </Text>
              </Pressable>
            )}
          />
        )}
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  container: { flex: 1, backgroundColor: c.surface },
  header: { flexDirection: "row", alignItems: "flex-end", paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md, gap: spacing.md },
  title: { fontSize: fontSize["3xl"], fontWeight: "900", letterSpacing: 1, color: c.onSurface },
  sub: { fontSize: fontSize.sm, color: c.muted, letterSpacing: 1, marginTop: 2 },
  weatherChip: { flexDirection: "row", alignItems: "center", gap: spacing.xs, borderWidth: 1, borderColor: c.borderStrong, paddingHorizontal: spacing.md, height: 36 },
  weatherChipOn: { backgroundColor: c.brandPrimary, borderColor: c.brandPrimary },
  weatherText: { fontSize: 11, fontWeight: "800", letterSpacing: 1, color: c.onSurface },
  clearBtn: { alignSelf: "flex-end", flexDirection: "row", alignItems: "center", gap: spacing.xs, height: 32, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: c.border, marginBottom: -spacing.sm },
  clearText: { fontSize: 10, fontWeight: "800", letterSpacing: 1, color: c.onSurface },
  hairline: { height: 1, backgroundColor: c.borderStrong },

  promptsWrap: { gap: spacing.md, marginTop: spacing.xl },
  promptsLabel: { fontSize: fontSize.sm, color: c.muted, letterSpacing: 2 },
  promptChip: { borderWidth: 1, borderColor: c.border, padding: spacing.lg, backgroundColor: c.surfaceTertiary },
  promptChipText: { fontSize: fontSize.base, color: c.onSurface, fontWeight: "600", letterSpacing: 0.3 },

  userMsg: { alignSelf: "flex-end", maxWidth: "85%", backgroundColor: c.brandPrimary, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  userText: { color: c.onBrandPrimary, fontSize: fontSize.base, fontWeight: "600" },

  typing: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md },
  typingText: { color: c.muted, letterSpacing: 2, fontSize: fontSize.sm },

  resultCard: { borderWidth: 1, borderColor: c.borderStrong, backgroundColor: c.surface },
  resultHead: { flexDirection: "row", alignItems: "flex-start", padding: spacing.lg, paddingBottom: spacing.md, gap: spacing.sm },
  resultName: { fontSize: fontSize.lg, fontWeight: "900", letterSpacing: 1, color: c.onSurface },
  resultHint: { fontSize: 9, letterSpacing: 1.5, color: c.muted, marginTop: 4, fontWeight: "700" },
  dismissBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: c.border },
  compositeRow: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  compositeItem: { width: 120, gap: spacing.sm, position: "relative" },
  compositeThumb: { width: 120, height: 140, backgroundColor: c.surfaceTertiary, borderWidth: 1, borderColor: c.border },
  swapBadge: { position: "absolute", right: 6, bottom: 6, width: 22, height: 22, alignItems: "center", justifyContent: "center", backgroundColor: c.brandPrimary },
  addTile: { width: 120, height: 140, alignItems: "center", justifyContent: "center", gap: spacing.xs, borderWidth: 1, borderColor: c.borderStrong, borderStyle: "dashed", backgroundColor: c.surfaceTertiary },
  addTileText: { fontSize: 10, letterSpacing: 1.5, fontWeight: "800", color: c.onSurface },
  compositeLabel: { fontSize: fontSize.sm, color: c.onSurface, fontWeight: "600" },
  vizBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, marginHorizontal: spacing.lg, marginBottom: spacing.lg, height: 48, borderWidth: 1, borderColor: c.borderStrong, backgroundColor: c.surfaceTertiary },
  vizBtnText: { fontSize: 11, fontWeight: "800", letterSpacing: 1, color: c.onSurface },
  vizBox: { marginHorizontal: spacing.lg, marginBottom: spacing.lg, borderWidth: 1, borderColor: c.borderStrong },
  vizImage: { width: "100%", aspectRatio: 3 / 4, backgroundColor: c.surfaceTertiary },
  vizCaption: { padding: spacing.sm, fontSize: 9, letterSpacing: 2, fontWeight: "800", color: c.muted, textAlign: "center" },
  feedbackRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginHorizontal: spacing.lg, marginBottom: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: c.border },
  feedbackLabel: { fontSize: 10, letterSpacing: 1.5, fontWeight: "800", color: c.muted },
  thumbBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: c.borderStrong },
  thumbBtnOn: { backgroundColor: c.brandPrimary, borderColor: c.brandPrimary },
  nudge: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderWidth: 1, borderColor: c.brandPrimary, backgroundColor: c.surface },
  nudgeIcon: { width: 36, height: 36, alignItems: "center", justifyContent: "center", backgroundColor: c.brandPrimary },
  nudgeTitle: { fontSize: fontSize.sm, fontWeight: "900", letterSpacing: 1, color: c.onSurface },
  nudgeSub: { fontSize: fontSize.sm, color: c.muted, marginTop: 2, lineHeight: 17 },
  nudgeCta: { fontSize: 10, fontWeight: "900", letterSpacing: 1, color: c.onSurface },
  pieceThumb: { width: 40, height: 40, backgroundColor: c.surfaceTertiary, borderWidth: 1, borderColor: c.border },
  pieceAction: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: c.border, minHeight: 64 },
  pieceActionTitle: { fontSize: fontSize.sm, fontWeight: "800", letterSpacing: 1, color: c.onSurface },
  pieceActionSub: { fontSize: fontSize.sm, color: c.muted, marginTop: 2 },
  noteBox: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.xs },
  noteLabel: { fontSize: fontSize.sm, letterSpacing: 2, color: c.muted },
  noteText: { fontSize: fontSize.base, color: c.onSurface, lineHeight: 21 },
  missing: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, color: c.muted, fontSize: fontSize.base, fontStyle: "italic" },
  shopLink: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginHorizontal: spacing.lg, marginBottom: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: c.borderStrong, backgroundColor: c.surfaceTertiary },
  shopText: { flex: 1, fontSize: 11, fontWeight: "800", letterSpacing: 1, color: c.onSurface },
  actions: { flexDirection: "row", paddingHorizontal: spacing.lg, gap: spacing.sm },
  addMissing: { padding: spacing.md, alignItems: "center", borderTopWidth: 1, borderTopColor: c.border, marginTop: spacing.md },
  addMissingText: { fontSize: fontSize.sm, letterSpacing: 2, color: c.onSurface, fontWeight: "700" },

  inputBar: { borderTopWidth: 1, borderTopColor: c.borderStrong, backgroundColor: c.surface, padding: spacing.md, gap: spacing.sm },
  focusPill: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 1, borderColor: c.border, padding: spacing.sm, backgroundColor: c.surfaceTertiary },
  focusThumb: { width: 32, height: 32, backgroundColor: c.surface },
  focusName: { flex: 1, fontSize: fontSize.sm, color: c.onSurface, fontWeight: "600" },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
  attachBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: c.border },
  input: { flex: 1, minHeight: 44, maxHeight: 120, borderWidth: 1, borderColor: c.border, paddingHorizontal: spacing.md, paddingTop: spacing.md, color: c.onSurface, fontSize: fontSize.base },
  sendBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center", backgroundColor: c.brandPrimary },

  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "70%", backgroundColor: c.surface, borderTopWidth: 1, borderTopColor: c.borderStrong, paddingHorizontal: spacing.lg },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: spacing.lg },
  sheetTitle: { fontSize: fontSize.lg, fontWeight: "900", letterSpacing: 1, color: c.onSurface },
  pickerCell: { flex: 1 / 3, padding: spacing.xs, gap: spacing.xs },
  pickerThumb: { aspectRatio: 1, backgroundColor: c.surfaceTertiary, borderWidth: 1, borderColor: c.border },
  pickerLabel: { fontSize: 11, color: c.onSurface },
  pickerCat: { fontSize: 9, letterSpacing: 1, color: c.muted },
  pickerEmpty: { paddingVertical: spacing.xl, textAlign: "center", fontSize: fontSize.sm, letterSpacing: 1, color: c.muted, fontWeight: "700" },
}));
