import { useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, Text, TextInput, View } from "react-native";
import { Camera, Images, Trash } from "phosphor-react-native";

import { api, imageUri, Profile, uploadProfilePhoto } from "@/src/api";
import { compressForUpload } from "@/src/compress-image";
import { useToast } from "@/src/toast";
import { fontSize, makeStyles, spacing, useTheme } from "@/src/theme";
import { Chip } from "@/src/ui";

export const GENDERS = ["Female", "Male", "Non-binary", "Prefer not to say"];

/**
 * Personal details the stylist uses for "Visualise on me": gender, age and a full-body photo.
 * The photo is stored privately and is only ever combined with the user's own wardrobe pieces.
 */
export function AboutYou({ profile, onUpdate }: { profile?: Profile; onUpdate: (patch: Partial<Profile>) => Promise<void> }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const { show } = useToast();
  const [age, setAge] = useState(profile?.age ? String(profile.age) : "");
  const [ageDirty, setAgeDirty] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const photoUri = preview || (profile?.photo_path ? imageUri({ storage_path: profile.photo_path }) : undefined);

  const commitAge = () => {
    if (!ageDirty) return;
    const n = parseInt(age, 10);
    if (!age.trim()) return;
    if (Number.isNaN(n) || n < 5 || n > 120) {
      show("Enter an age between 5 and 120", "error");
      return;
    }
    setAgeDirty(false);
    onUpdate({ age: n });
  };

  const pick = async (source: "camera" | "library") => {
    setError(null);
    try {
      const perm = source === "camera" ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        if (!perm.canAskAgain) {
          setError(`${source === "camera" ? "Camera" : "Photos"} access is off for StyleVault. Enable it in Settings.`);
          if (Platform.OS !== "web") Linking.openSettings();
        } else {
          setError(`${source === "camera" ? "Camera" : "Photos"} permission is needed to add your photo.`);
        }
        return;
      }
      const result =
        source === "camera"
          ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.85, exif: false })
          : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85, exif: false });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      setUploading(true);
      const uri = Platform.OS === "web" ? asset.uri : await compressForUpload(asset.uri, asset.width, asset.height).catch(() => asset.uri);
      setPreview(uri);
      await uploadProfilePhoto(uri);
      qc.invalidateQueries({ queryKey: ["profile"] });
      show("Photo saved — the stylist can now dress you", "success");
    } catch (e: any) {
      setPreview(null);
      setError(e?.message && e.message !== "Network request failed" ? e.message : "Could not upload photo. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  const removePhoto = async () => {
    try {
      await api.deleteProfilePhoto();
      setPreview(null);
      qc.invalidateQueries({ queryKey: ["profile"] });
      show("Photo removed", "success");
    } catch {
      show("Could not remove photo", "error");
    }
  };

  return (
    <View style={{ gap: spacing.lg }} testID="about-you">
      <View>
        <Text style={styles.label}>I AM</Text>
        <View style={styles.chipWrap}>
          {GENDERS.map((g) => (
            <Chip key={g} label={g} active={profile?.gender === g} onPress={() => onUpdate({ gender: g })} testID={`gender-${g}`} />
          ))}
        </View>
      </View>

      <View>
        <Text style={styles.label}>AGE</Text>
        <TextInput
          testID="age-input"
          style={styles.input}
          value={age}
          onChangeText={(t) => {
            setAge(t.replace(/[^0-9]/g, "").slice(0, 3));
            setAgeDirty(true);
          }}
          onBlur={commitAge}
          onSubmitEditing={commitAge}
          keyboardType="number-pad"
          returnKeyType="done"
          placeholder="e.g. 32"
          placeholderTextColor={colors.muted}
        />
      </View>

      <View>
        <Text style={styles.label}>YOUR PHOTO · FOR "VISUALISE ON ME"</Text>
        <Text style={styles.hint}>A full-body, front-facing photo in plain clothes works best. It stays private to your account.</Text>
        <View style={styles.photoRow}>
          <View style={styles.photoBox}>
            {photoUri ? (
              <Image source={{ uri: photoUri }} style={{ width: "100%", height: "100%" }} contentFit="cover" testID="profile-photo" />
            ) : (
              <Text style={styles.photoEmpty} testID="profile-photo-empty">
                NO PHOTO YET
              </Text>
            )}
            {uploading && (
              <View style={styles.photoOverlay} testID="photo-uploading">
                <ActivityIndicator color={colors.onSurfaceInverse} />
              </View>
            )}
          </View>
          <View style={{ flex: 1, gap: spacing.sm }}>
            <Pressable style={styles.photoBtn} onPress={() => pick("camera")} disabled={uploading} testID="photo-camera-btn">
              <Camera color={colors.onSurface} size={18} />
              <Text style={styles.photoBtnText}>TAKE PHOTO</Text>
            </Pressable>
            <Pressable style={styles.photoBtn} onPress={() => pick("library")} disabled={uploading} testID="photo-library-btn">
              <Images color={colors.onSurface} size={18} />
              <Text style={styles.photoBtnText}>CHOOSE PHOTO</Text>
            </Pressable>
            {!!photoUri && !uploading && (
              <Pressable style={styles.photoBtn} onPress={removePhoto} testID="photo-remove-btn">
                <Trash color={colors.onSurface} size={18} />
                <Text style={styles.photoBtnText}>REMOVE</Text>
              </Pressable>
            )}
          </View>
        </View>
        {!!error && (
          <Text style={styles.error} testID="photo-error">
            {error}
          </Text>
        )}
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  label: { fontSize: fontSize.sm, letterSpacing: 2, color: c.muted, marginBottom: spacing.sm },
  hint: { fontSize: fontSize.sm, color: c.muted, lineHeight: 18, marginBottom: spacing.md },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  input: { height: 48, width: 120, borderWidth: 1, borderColor: c.border, paddingHorizontal: spacing.md, color: c.onSurface, fontSize: fontSize.base },
  photoRow: { flexDirection: "row", gap: spacing.md },
  photoBox: { width: 120, height: 160, backgroundColor: c.surfaceTertiary, borderWidth: 1, borderColor: c.border, alignItems: "center", justifyContent: "center" },
  photoEmpty: { fontSize: 10, letterSpacing: 1.5, color: c.muted, fontWeight: "700" },
  photoOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.45)" },
  photoBtn: { height: 44, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: c.borderStrong, backgroundColor: c.surfaceTertiary },
  photoBtnText: { fontSize: 11, fontWeight: "800", letterSpacing: 1, color: c.onSurface },
  error: { marginTop: spacing.sm, color: c.error, fontSize: fontSize.sm, fontWeight: "700" },
}));
