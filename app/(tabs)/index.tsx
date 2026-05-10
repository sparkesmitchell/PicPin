import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, KeyboardAvoidingView, PanResponder, Platform, ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ViewShot from 'react-native-view-shot';

// x, y are normalized fractions [0..1] of the image container dimensions
type Pin = { id: number; x: number; y: number; note: string };
type SavedPhoto = {
  id: number; uri: string; flatUri?: string; pins: Pin[]; title: string;
  timestamp?: number; containerWidth?: number; containerHeight?: number;
  pinsAreNormalized?: boolean;
};

const COLORS = {
  bg: '#0f0f0f',
  surface: '#1c1c1e',
  surface2: '#2c2c2e',
  accent: '#0a84ff',
  danger: '#ff453a',
  success: '#32d74b',
  text: '#ffffff',
  textSecondary: '#ebebf599',
  border: '#38383a',
};

function DraggablePin({ pin, onTap, onDragEnd, isDragging }: {
  pin: Pin; // x, y are screen-space pixels here
  onTap: () => void;
  onDragEnd: (id: number, x: number, y: number, isDragging: boolean) => void;
  isDragging: boolean;
}) {
  const pressStartTime = useRef(0);
  const didDrag = useRef(false);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dx) > 5 || Math.abs(gs.dy) > 5,
    onPanResponderGrant: () => {
      pressStartTime.current = Date.now();
      didDrag.current = false;
    },
    onPanResponderMove: (_, gs) => {
      didDrag.current = true;
      onDragEnd(pin.id, pin.x + gs.dx, pin.y + gs.dy, true);
    },
    onPanResponderRelease: (_, gs) => {
      const elapsed = Date.now() - pressStartTime.current;
      if (!didDrag.current && elapsed < 300) {
        onTap();
      } else {
        onDragEnd(pin.id, pin.x + gs.dx, pin.y + gs.dy, false);
      }
    },
  }), [pin.id, pin.x, pin.y]);

  return (
    <View
      style={[
        styles.pin,
        { left: pin.x - 15, top: pin.y - 15 },
        isDragging && styles.pinDragging,
      ]}
      {...panResponder.panHandlers}
    >
      <View style={styles.pinDot} />
      {pin.note ? (
        <View style={styles.notePreview}>
          <Text style={styles.notePreviewText} numberOfLines={1}>{pin.note}</Text>
        </View>
      ) : null}
    </View>
  );
}

export default function App() {
  const [permission, requestPermission] = useCameraPermissions();
  const [photo, setPhoto] = useState<string | null>(null);
  const [pins, setPins] = useState<Pin[]>([]); // normalized [0..1] coords
  const [selectedPin, setSelectedPin] = useState<Pin | null>(null);
  const [noteText, setNoteText] = useState('');
  const [savedPhotos, setSavedPhotos] = useState<SavedPhoto[]>([]);
  const [showGallery, setShowGallery] = useState(false);
  const [showTitleModal, setShowTitleModal] = useState(false);
  const [titleText, setTitleText] = useState('');
  const [editingPhotoId, setEditingPhotoId] = useState<number | null>(null);
  const cameraRef = useRef<any>(null);
  const viewShotRef = useRef<any>(null);
  const [draggingPinId, setDraggingPinId] = useState<number | null>(null);
  const [photoTimestamp, setPhotoTimestamp] = useState<number | null>(null);
  const [pinContainerDims, setPinContainerDims] = useState<{ width: number; height: number } | null>(null);

  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const rawIsLandscape = windowWidth > windowHeight;
  const [isLandscape, setIsLandscape] = useState(rawIsLandscape);
  useEffect(() => {
    const t = setTimeout(() => setIsLandscape(rawIsLandscape), 400);
    return () => clearTimeout(t);
  }, [rawIsLandscape]);
  const insets = useSafeAreaInsets();

  useEffect(() => { loadSavedPhotos(); }, []);

  async function loadSavedPhotos() {
    try {
      const data = await AsyncStorage.getItem('savedPhotos');
      if (data) setSavedPhotos(JSON.parse(data));
    } catch (e) { console.log('Error loading photos', e); }
  }

  function handleContainerLayout(event: any) {
    const { width, height } = event.nativeEvent.layout;
    if (width > 0 && height > 0) {
      setPinContainerDims({ width, height });
    }
  }

  function normalizeLegacyPins(legacyPins: Pin[], containerWidth?: number, containerHeight?: number): Pin[] {
    const w = containerWidth ?? 375;
    const h = containerHeight ?? 667;
    return legacyPins.map(p => ({ ...p, x: p.x / w, y: p.y / h }));
  }

  async function saveCurrentPhoto() {
    setShowTitleModal(true);
  }

  async function confirmSave(title: string, currentEditingId: number | null) {
    try {
      if (!viewShotRef.current) return;
      const flatUri = await viewShotRef.current.capture();
      let updated;
      if (currentEditingId) {
        updated = savedPhotos.map(p => p.id === currentEditingId
          ? { ...p, title: title || 'Untitled', pins, flatUri, pinsAreNormalized: true, containerWidth: pinContainerDims?.width, containerHeight: pinContainerDims?.height }
          : p);
      } else {
        const now = Date.now();
        const newEntry: SavedPhoto = {
          id: now, uri: photo!, flatUri, pins, pinsAreNormalized: true,
          title: title || 'Untitled', timestamp: photoTimestamp ?? now,
          containerWidth: pinContainerDims?.width, containerHeight: pinContainerDims?.height,
        };
        updated = [newEntry, ...savedPhotos];
      }
      const jsonString = JSON.stringify(updated);
      await AsyncStorage.setItem('savedPhotos', jsonString);
      setSavedPhotos(JSON.parse(jsonString));
      setShowTitleModal(false);
      setTitleText('');
      setEditingPhotoId(null);
      alert(currentEditingId ? 'Photo updated!' : 'Photo saved!');
    } catch (e: any) { alert('Error: ' + e.message); }
  }

  async function deletePhoto(id: number) {
    const updated = savedPhotos.filter(p => p.id !== id);
    await AsyncStorage.setItem('savedPhotos', JSON.stringify(updated));
    setSavedPhotos(updated);
  }

  async function takePhoto() {
    if (cameraRef.current) {
      const result = await cameraRef.current.takePictureAsync({ exif: true, skipProcessing: false });
      const orientation: number = (result.exif as any)?.Orientation ?? 1;
      // EXIF 6 = portrait (home bottom) needs 90° CW; 8 = portrait (home top) needs 90° CCW; 3 = 180°
      const rotationMap: Record<number, number> = { 3: 180, 6: 90, 8: -90 };
      const deg = rotationMap[orientation];
      if (deg !== undefined) {
        const { uri } = await ImageManipulator.manipulateAsync(
          result.uri, [{ rotate: deg }], { compress: 1, format: ImageManipulator.SaveFormat.JPEG }
        );
        setPhoto(uri);
      } else {
        setPhoto(result.uri);
      }
      setPins([]);
      setPinContainerDims(null);
      setPhotoTimestamp(Date.now());
    }
  }

  async function pickFromGallery() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
    });
    if (!result.canceled) {
      setPhoto(result.assets[0].uri);
      setPins([]);
      setPinContainerDims(null);
      setPhotoTimestamp(Date.now());
    }
  }

  async function sharePhoto() {
    try {
      if (!viewShotRef.current) return;
      const uri = await viewShotRef.current.capture();
      await Sharing.shareAsync(uri);
    } catch (e: any) { alert('Error sharing: ' + e.message); }
  }

  async function saveGalleryPhotoToRoll(uri: string) {
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') { alert('Permission needed'); return; }
      await MediaLibrary.saveToLibraryAsync(uri);
      alert('Saved to camera roll!');
    } catch (e: any) { alert('Error: ' + e.message); }
  }

  function handleImageTap(event: any) {
    if (!pinContainerDims) return;
    const { locationX, locationY } = event.nativeEvent;
    const newPin: Pin = {
      id: Date.now(),
      x: locationX / pinContainerDims.width,
      y: locationY / pinContainerDims.height,
      note: '',
    };
    setPins(prev => [...prev, newPin]);
    setSelectedPin(newPin);
    setNoteText('');
  }

  function handlePinTap(pin: Pin) {
    setSelectedPin(pin);
    setNoteText(pin.note);
  }

  function handlePinDrag(id: number, newScreenX: number, newScreenY: number, isDragging: boolean) {
    if (!pinContainerDims) return;
    setDraggingPinId(isDragging ? id : null);
    const nx = Math.max(0, Math.min(1, newScreenX / pinContainerDims.width));
    const ny = Math.max(0, Math.min(1, newScreenY / pinContainerDims.height));
    setPins(prev => prev.map(p => p.id === id ? { ...p, x: nx, y: ny } : p));
  }

  function saveNote() {
    if (!selectedPin) return;
    setPins(prev => prev.map(p => p.id === selectedPin.id ? { ...p, note: noteText } : p));
    setSelectedPin(null);
  }

  function deletePin() {
    if (!selectedPin) return;
    setPins(prev => prev.filter(p => p.id !== selectedPin.id));
    setSelectedPin(null);
  }

  function openSavedPhoto(entry: SavedPhoto) {
    const normalizedPins = entry.pinsAreNormalized
      ? entry.pins
      : normalizeLegacyPins(entry.pins, entry.containerWidth, entry.containerHeight);
    setPhoto(entry.uri);
    setPins(normalizedPins);
    setEditingPhotoId(entry.id);
    setPhotoTimestamp(entry.timestamp ?? entry.id);
    setPinContainerDims(
      entry.containerWidth && entry.containerHeight
        ? { width: entry.containerWidth, height: entry.containerHeight }
        : null
    );
    setShowGallery(false);
  }

  if (!permission) return <View />;

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>Camera access is needed to use PinNotes</Text>
        <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
          <Text style={styles.permissionButtonText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (showGallery) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" />
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <TouchableOpacity onPress={() => setShowGallery(false)} style={styles.headerBack}>
            <Text style={styles.headerBackText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>My Photos</Text>
          <View style={{ width: 70 }} />
        </View>
        <ScrollView contentContainerStyle={styles.galleryGrid}>
          {savedPhotos.length === 0 && (
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>📷</Text>
              <Text style={styles.emptyTitle}>No photos yet</Text>
              <Text style={styles.emptySubtitle}>Take a photo and save it to see it here</Text>
            </View>
          )}
          {savedPhotos.map(entry => (
            <View key={entry.id} style={styles.galleryCard}>
              <TouchableOpacity onPress={() => openSavedPhoto(entry)}>
                <Image source={{ uri: entry.flatUri || entry.uri }} style={styles.thumbnail} />
                <View style={styles.cardInfo}>
                  <Text style={styles.cardTitle}>{entry.title || 'Untitled'}</Text>
                  <Text style={styles.cardPins}>{entry.pins.length} pin{entry.pins.length !== 1 ? 's' : ''}</Text>
                </View>
              </TouchableOpacity>
              <View style={styles.cardActions}>
                <TouchableOpacity style={styles.cardActionBtn} onPress={() => saveGalleryPhotoToRoll(entry.flatUri || entry.uri)}>
                  <Text style={styles.cardActionText}>💾 Save</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.cardActionBtn, styles.cardDeleteBtn]} onPress={() => deletePhoto(entry.id)}>
                  <Text style={styles.cardActionText}>🗑 Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    );
  }

  if (photo) {
    const ts = new Date(photoTimestamp ?? Date.now());
    const tsDate = ts.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const tsTime = ts.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    return (
      <View style={[styles.container, isLandscape && styles.containerLandscape]}>
        <StatusBar barStyle="light-content" />

        <ViewShot ref={viewShotRef} style={styles.imageContainer} onLayout={handleContainerLayout}>
          <TouchableOpacity activeOpacity={1} onPress={handleImageTap} style={styles.imageContainer}>
            <Image source={{ uri: photo }} style={styles.camera} />
            <View style={styles.watermark}>
              <Text style={styles.watermarkText}>PicPins App</Text>
            </View>
            <View style={styles.timestamp}>
              <Text style={styles.timestampText}>{tsDate} {tsTime}</Text>
            </View>
            {pinContainerDims && pins.map(pin => {
              const screenX = pin.x * pinContainerDims.width;
              const screenY = pin.y * pinContainerDims.height;
              return (
                <DraggablePin
                  key={pin.id}
                  pin={{ ...pin, x: screenX, y: screenY }}
                  onTap={() => handlePinTap(pin)}
                  onDragEnd={(id, sx, sy, dragging) => handlePinDrag(id, sx, sy, dragging)}
                  isDragging={draggingPinId === pin.id}
                />
              );
            })}
          </TouchableOpacity>
        </ViewShot>

        <View style={[
          styles.actionBar,
          isLandscape
            ? [styles.actionBarLandscape, { paddingRight: Math.max(insets.right, 12) + 8 }]
            : [styles.actionBarPortrait, { paddingBottom: Math.max(insets.bottom, 16) + 4 }],
        ]}>
          <TouchableOpacity style={styles.iconBtn} onPress={() => { setPhoto(null); setEditingPhotoId(null); setPinContainerDims(null); }}>
            <Text style={styles.iconBtnIcon}>✕</Text>
            <Text style={styles.iconBtnLabel}>Retake</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={sharePhoto}>
            <Text style={styles.iconBtnIcon}>↗</Text>
            <Text style={styles.iconBtnLabel}>Share</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.iconBtn, styles.iconBtnAccent]} onPress={saveCurrentPhoto}>
            <Text style={styles.iconBtnIcon}>💾</Text>
            <Text style={styles.iconBtnLabel}>Save</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={() => setShowGallery(true)}>
            <Text style={styles.iconBtnIcon}>▦</Text>
            <Text style={styles.iconBtnLabel}>Gallery</Text>
          </TouchableOpacity>
        </View>

        {selectedPin !== null && (
          <View style={[StyleSheet.absoluteFill, { justifyContent: 'flex-end' }]}>
            <TouchableOpacity
              style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.6)' }]}
              activeOpacity={1}
              onPress={() => setSelectedPin(null)}
            />
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
              <View style={styles.modalBox}>
                <View style={styles.modalHandle} />
                <Text style={styles.modalTitle}>📍 Pin Note</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="Add a note..."
                  placeholderTextColor={COLORS.textSecondary}
                  value={noteText}
                  onChangeText={setNoteText}
                  multiline
                  autoFocus
                />
                <TouchableOpacity style={styles.saveButton} onPress={saveNote}>
                  <Text style={styles.saveText}>Save Note</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.deleteButton} onPress={deletePin}>
                  <Text style={styles.deleteText}>Delete Pin</Text>
                </TouchableOpacity>
              </View>
            </KeyboardAvoidingView>
          </View>
        )}

        {showTitleModal && (
          <View style={[StyleSheet.absoluteFill, { justifyContent: 'flex-end' }]}>
            <TouchableOpacity
              style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.6)' }]}
              activeOpacity={1}
              onPress={() => setShowTitleModal(false)}
            />
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
              <View style={styles.modalBox}>
                <View style={styles.modalHandle} />
                <Text style={styles.modalTitle}>Name this photo</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="e.g. Living room inspection"
                  placeholderTextColor={COLORS.textSecondary}
                  value={titleText}
                  onChangeText={setTitleText}
                  autoFocus
                />
                <TouchableOpacity style={styles.saveButton} onPress={() => confirmSave(titleText, editingPhotoId)}>
                  <Text style={styles.saveText}>Save</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.deleteButton} onPress={() => setShowTitleModal(false)}>
                  <Text style={styles.deleteText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </KeyboardAvoidingView>
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <CameraView
        style={styles.camera}
        facing="back"
        ref={cameraRef}
        videoStabilizationMode="auto"
      />
      <View style={[styles.cameraTopBar, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.appName}>PicPins</Text>
      </View>
      <View style={[styles.cameraBottomBar, { paddingBottom: insets.bottom + 16, paddingLeft: insets.left, paddingRight: insets.right }]}>
        <TouchableOpacity style={styles.sideBtn} onPress={pickFromGallery}>
          <Text style={styles.sideBtnIcon}>📷</Text>
          <Text style={styles.sideBtnLabel}>Roll</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.captureButton} onPress={takePhoto}>
          <View style={styles.captureInner} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.sideBtn} onPress={() => setShowGallery(true)}>
          <Text style={styles.sideBtnIcon}>▦</Text>
          <Text style={styles.sideBtnLabel}>Gallery</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  containerLandscape: { flexDirection: 'row' },
  message: { textAlign: 'center', color: COLORS.text, fontSize: 16, padding: 24 },
  permissionButton: { backgroundColor: COLORS.accent, margin: 24, padding: 16, borderRadius: 12, alignItems: 'center' },
  permissionButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  camera: { flex: 1 },
  imageContainer: { flex: 1 },

  // Camera screen
  cameraTopBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    paddingBottom: 16, paddingHorizontal: 24,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
  },
  appName: { color: '#fff', fontSize: 20, fontWeight: '700', letterSpacing: 1 },
  cameraBottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
    paddingTop: 24,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  captureButton: {
    width: 76, height: 76, borderRadius: 38,
    backgroundColor: 'rgba(255,255,255,0.25)',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.6)',
  },
  captureInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#fff' },
  sideBtn: { alignItems: 'center', width: 64 },
  sideBtnIcon: { fontSize: 26 },
  sideBtnLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 11, marginTop: 4 },

  // Photo view — action bar
  actionBar: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
  },
  actionBarPortrait: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: 16,
    borderTopWidth: 1,
  },
  actionBarLandscape: {
    flexDirection: 'column',
    justifyContent: 'space-around',
    paddingVertical: 16,
    paddingLeft: 12,
    width: 90,
    borderLeftWidth: 1,
  },
  iconBtn: { alignItems: 'center', padding: 10, borderRadius: 12, minWidth: 70, backgroundColor: COLORS.surface2, borderWidth: 1, borderColor: COLORS.border },
  iconBtnAccent: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  iconBtnIcon: { fontSize: 22 },
  iconBtnLabel: { color: COLORS.text, fontSize: 11, marginTop: 4 },

  // Pins
  pin: { position: 'absolute', alignItems: 'center' },
  pinDot: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: '#ff3b30',
    borderWidth: 2.5, borderColor: '#fff',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4, shadowRadius: 3,
  },
  notePreview: {
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3,
    maxWidth: 120, marginTop: 2,
  },
  notePreviewText: { color: '#fff', fontSize: 10 },
  pinDragging: { opacity: 0.75, transform: [{ scale: 1.2 }] },

  // Gallery
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingBottom: 16, paddingHorizontal: 16,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  headerBack: { width: 70 },
  headerBackText: { color: COLORS.accent, fontSize: 16 },
  headerTitle: { color: COLORS.text, fontSize: 18, fontWeight: '700' },
  galleryGrid: { padding: 16, gap: 16 },
  galleryCard: {
    backgroundColor: COLORS.surface, borderRadius: 16, overflow: 'hidden',
    borderWidth: 1, borderColor: COLORS.border,
  },
  thumbnail: { width: '100%', height: 220 },
  cardInfo: { padding: 12 },
  cardTitle: { color: COLORS.text, fontSize: 16, fontWeight: '600' },
  cardPins: { color: COLORS.textSecondary, fontSize: 13, marginTop: 2 },
  cardActions: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: COLORS.border },
  cardActionBtn: { flex: 1, padding: 12, alignItems: 'center', backgroundColor: COLORS.surface2 },
  cardDeleteBtn: { backgroundColor: '#2c1a1a', borderLeftWidth: 1, borderLeftColor: COLORS.border },
  cardActionText: { color: COLORS.text, fontSize: 13 },
  emptyState: { alignItems: 'center', paddingTop: 80 },
  emptyEmoji: { fontSize: 48, marginBottom: 16 },
  emptyTitle: { color: COLORS.text, fontSize: 20, fontWeight: '600', marginBottom: 8 },
  emptySubtitle: { color: COLORS.textSecondary, fontSize: 14, textAlign: 'center', paddingHorizontal: 32 },

  // Modals
  modalBox: {
    backgroundColor: COLORS.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 40, maxHeight: '80%',
  },
  modalHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: COLORS.border, alignSelf: 'center', marginBottom: 20,
  },
  modalTitle: { color: COLORS.text, fontSize: 18, fontWeight: '700', marginBottom: 16 },
  textInput: {
    backgroundColor: COLORS.surface2, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: 12, padding: 14, fontSize: 16, color: COLORS.text,
    minHeight: 90, marginBottom: 16,
  },
  saveButton: {
    backgroundColor: COLORS.accent, padding: 16,
    borderRadius: 12, alignItems: 'center', marginBottom: 8,
  },
  saveText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  deleteButton: { padding: 14, borderRadius: 12, alignItems: 'center' },
  deleteText: { color: COLORS.danger, fontSize: 16 },

  timestamp: {
    position: 'absolute', bottom: 12, right: 12,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 6,
  },
  timestampText: { color: '#fff', fontSize: 11, fontFamily: 'monospace' },

  watermark: {
    position: 'absolute', top: 12, right: 12,
    backgroundColor: 'rgba(0,0,0,0.4)',
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 6,
  },
  watermarkText: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '700', letterSpacing: 1 },
});