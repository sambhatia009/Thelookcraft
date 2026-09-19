import { Image } from "expo-image";
import { View } from "react-native";

import { imageUri, Item } from "@/src/api";
import { makeStyles, useTheme } from "@/src/theme";

export function ItemThumb({ item, contentFit = "contain" }: { item: Item; contentFit?: "contain" | "cover" }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const uri = imageUri(item);
  return (
    <View style={styles.wrap}>
      {uri ? (
        <Image
          source={{ uri }}
          style={styles.img}
          contentFit={contentFit}
          transition={200}
          cachePolicy="memory-disk"
          recyclingKey={item.id}
        />
      ) : (
        <View style={[styles.img, { backgroundColor: colors.surfaceTertiary }]} />
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  wrap: { flex: 1, backgroundColor: c.surfaceTertiary },
  img: { width: "100%", height: "100%" },
}));
