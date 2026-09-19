import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import { ArrowUp, Paperclip, X } from "phosphor-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, Item, OutfitResult } from "@/src/api";
import { ItemThumb } from "@/src/components/item-thumb";
import { usesNativeTabs } from "@/src/navigation";
import { useToast } from "@/src/toast";
import { fontSize, makeStyles, spacing, useTheme } from "@/src/theme";
import { Button } from "@/src/ui";

type Msg =
  | { kind: "user"; text: string }
  | { kind: "result"; result: OutfitResult; saved?: boolean; id: string };

const QUICK_PROMPTS = [
  "Style an office visit outfit",
  "Casual weekend look",
  "Date night in autumn",
  "Build a smart casual look",
];

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
  const scrollRef = useRef<ScrollView>(null);

  const { data: items } = useQuery({ queryKey: ["items", "All"], queryFn: () => api.items("All") });

  useEffect(() => {
    if (params.focusId && items) {
      const it = items.find((i) => i.id === params.focusId);
      if (it) setFocus(it);
    }
  }, [params.focusId, items]);

  const generate = useMutation({
    mutationFn: ({ prompt, focusId }: { prompt: string; focusId?: string | null }) => api.stylist(prompt, focusId),
    onSuccess: (result) => {
      setMessages((m) => [...m, { kind: "result", result, id: `${Date.now()}` }]);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    },
    onError: (e: any) => show(e?.message || "Stylist unavailable", "error"),
  });

  const send = (text: string) => {
    const prompt = text.trim();
    if (!prompt) return;
    const label = focus ? `${prompt}  ·  [${focus.name}]` : prompt;
    setMessages((m) => [...m, { kind: "user", text: label }]);
    setInput("");
    generate.mutate({ prompt, focusId: focus?.id });
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const retry = (prompt: string) => {
    setMessages((m) => [...m, { kind: "user", text: prompt }]);
    generate.mutate({ prompt, focusId: focus?.id });
  };

  const saveOutfit = async (msg: Extract<Msg, { kind: "result" }>) => {
    try {
      await api.saveOutfit({
        title: msg.result.outfit_name,
        item_ids: msg.result.item_ids,
        stylist_note: msg.result.stylist_note,
      });
      setMessages((m) => m.map((x) => (x.kind === "result" && x.id === msg.id ? { ...x, saved: true } : x)));
      qc.invalidateQueries({ queryKey: ["outfits"] });
      show("Saved to lookbook", "success");
    } catch {
      show("Could not save outfit", "error");
    }
  };

  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const empty = messages.length === 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>STYLIST</Text>
        <Text style={styles.sub}>AI-CURATED FROM YOUR CLOSET</Text>
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

        {messages.map((m, idx) =>
          m.kind === "user" ? (
            <View key={idx} style={styles.userMsg}>
              <Text style={styles.userText}>{m.text}</Text>
            </View>
          ) : (
            <ResultCard key={m.id} msg={m} onSave={() => saveOutfit(m)} onRetry={() => retry(QUICK_PROMPTS[0])} onAddMissing={() => router.push("/add-item")} />
          )
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
              placeholder="Ask your stylist..."
              placeholderTextColor={colors.muted}
              value={input}
              onChangeText={setInput}
              multiline
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
        items={items || []}
        onClose={() => setPickerOpen(false)}
        onPick={(it) => {
          setFocus(it);
          setPickerOpen(false);
        }}
      />
    </View>
  );
}

function ResultCard({
  msg,
  onSave,
  onRetry,
  onAddMissing,
}: {
  msg: Extract<Msg, { kind: "result" }>;
  onSave: () => void;
  onRetry: () => void;
  onAddMissing: () => void;
}) {
  const styles = useStyles();
  const r = msg.result;
  return (
    <View style={styles.resultCard} testID="outfit-result">
      <Text style={styles.resultName}>{r.outfit_name.toUpperCase()}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.compositeRow}>
        {r.items.map((it) => (
          <View key={it.id} style={styles.compositeItem}>
            <View style={styles.compositeThumb}>
              <ItemThumb item={it} />
            </View>
            <Text numberOfLines={1} style={styles.compositeLabel}>
              {it.name}
            </Text>
          </View>
        ))}
      </ScrollView>
      {!!r.stylist_note && (
        <View style={styles.noteBox}>
          <Text style={styles.noteLabel}>STYLIST NOTE</Text>
          <Text style={styles.noteText}>{r.stylist_note}</Text>
        </View>
      )}
      {!!r.missing_suggestion && (
        <Text style={styles.missing}>+ Consider adding: {r.missing_suggestion}</Text>
      )}
      <View style={styles.actions}>
        <Button
          title={msg.saved ? "Saved ✓" : "Save Outfit"}
          onPress={onSave}
          disabled={msg.saved}
          testID="save-outfit-btn"
          style={{ flex: 1 }}
        />
        <Button title="Try Another" variant="outline" onPress={onRetry} testID="try-another-btn" style={{ flex: 1 }} />
      </View>
      <Pressable onPress={onAddMissing} style={styles.addMissing} testID="add-missing-btn">
        <Text style={styles.addMissingText}>ADD MISSING ITEM</Text>
      </Pressable>
    </View>
  );
}

function ItemPicker({
  open,
  items,
  onClose,
  onPick,
}: {
  open: boolean;
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
          <Text style={styles.sheetTitle}>ATTACH AN ITEM</Text>
          <Pressable onPress={onClose} testID="picker-close" hitSlop={8}>
            <X color={colors.onSurface} size={22} weight="bold" />
          </Pressable>
        </View>
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
            </Pressable>
          )}
        />
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  container: { flex: 1, backgroundColor: c.surface },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  title: { fontSize: fontSize["3xl"], fontWeight: "900", letterSpacing: 1, color: c.onSurface },
  sub: { fontSize: fontSize.sm, color: c.muted, letterSpacing: 1, marginTop: 2 },
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
  resultName: { fontSize: fontSize.lg, fontWeight: "900", letterSpacing: 1, color: c.onSurface, padding: spacing.lg, paddingBottom: spacing.md },
  compositeRow: { gap: 1, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  compositeItem: { width: 120, gap: spacing.sm },
  compositeThumb: { width: 120, height: 140, backgroundColor: c.surfaceTertiary, borderWidth: 1, borderColor: c.border },
  compositeLabel: { fontSize: fontSize.sm, color: c.onSurface, fontWeight: "600" },
  noteBox: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.xs },
  noteLabel: { fontSize: fontSize.sm, letterSpacing: 2, color: c.muted },
  noteText: { fontSize: fontSize.base, color: c.onSurface, lineHeight: 21 },
  missing: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, color: c.muted, fontSize: fontSize.base, fontStyle: "italic" },
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
}));
