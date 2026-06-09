import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import * as Print from 'expo-print';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as Sharing from 'expo-sharing';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Image, KeyboardAvoidingView, Modal, PanResponder, Platform, ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import ViewShot from 'react-native-view-shot';

type Pin = { id: number; x: number; y: number; note: string };
type Folder = { id: string; name: string; createdAt: number };
type SavedPhoto = { id: number; uri: string; flatUri?: string; pins: Pin[]; title: string; timestamp?: number; folderId: string };

const DEFAULT_FOLDER: Folder = { id: 'general', name: 'General', createdAt: 0 };
// Height (incl. gap) of a single reorderable photo row in a folder.
const ROW_HEIGHT = 88;
const STORAGE_KEY_PHOTOS = 'savedPhotos';
const STORAGE_KEY_FOLDERS = 'savedFolders';
const PHOTO_DIR = FileSystem.documentDirectory + 'picpins/';

// Copies an image out of a temporary/cache location into the app's permanent
// document directory so it survives iOS purging tmp/cache. Returns the new uri,
// or the original uri if the copy fails.
async function persistImage(uri: string, name: string): Promise<string> {
  try {
    const dir = await FileSystem.getInfoAsync(PHOTO_DIR);
    if (!dir.exists) await FileSystem.makeDirectoryAsync(PHOTO_DIR, { intermediates: true });
    const dest = PHOTO_DIR + name;
    await FileSystem.copyAsync({ from: uri, to: dest });
    return dest;
  } catch (e) {
    console.log('persistImage failed', e);
    return uri;
  }
}

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

function DraggablePin({ pin, onTap, onDragEnd, isDragging }: { pin: Pin; onTap: (pin: Pin) => void; onDragEnd: (id: number, x: number, y: number, isDragging: boolean) => void; isDragging: boolean }) {
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
        onTap(pin);
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

function PhotoRow({
  entry,
  top,
  isDragging,
  onStart,
  onMove,
  onEnd,
  onOpen,
  onDelete,
  onSaveToRoll,
}: {
  entry: SavedPhoto;
  top: Animated.Value | number;
  isDragging: boolean;
  onStart: (id: number) => void;
  onMove: (dy: number) => void;
  onEnd: () => void;
  onOpen: (entry: SavedPhoto) => void;
  onDelete: (entry: SavedPhoto) => void;
  onSaveToRoll: (uri: string) => void;
}) {
  // The panResponder is memoized on entry.id, so it must call the *latest*
  // handlers through a ref — otherwise it captures the first render's
  // callbacks (when draggingId was still null) and every drag bails out.
  const cbRef = useRef({ onStart, onMove, onEnd });
  cbRef.current = { onStart, onMove, onEnd };
  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => cbRef.current.onStart(entry.id),
    onPanResponderMove: (_, gs) => cbRef.current.onMove(gs.dy),
    onPanResponderRelease: () => cbRef.current.onEnd(),
    onPanResponderTerminate: () => cbRef.current.onEnd(),
  }), [entry.id]);

  return (
    <Animated.View
      style={[
        styles.reorderRow,
        { top, height: ROW_HEIGHT - 8, zIndex: isDragging ? 10 : 1 },
        isDragging && styles.reorderRowActive,
      ]}
    >
      <TouchableOpacity style={styles.reorderMain} onPress={() => onOpen(entry)} activeOpacity={0.7}>
        <Image source={{ uri: entry.flatUri || entry.uri }} style={styles.reorderThumb} />
        <View style={styles.reorderInfo}>
          <Text style={styles.reorderTitle} numberOfLines={1}>{entry.title || 'Untitled'}</Text>
          <Text style={styles.reorderPins}>{entry.pins.length} pin{entry.pins.length !== 1 ? 's' : ''}</Text>
        </View>
      </TouchableOpacity>
      <TouchableOpacity style={styles.reorderIconBtn} onPress={() => onSaveToRoll(entry.flatUri || entry.uri)}>
        <Text style={styles.reorderIconText}>💾</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.reorderIconBtn} onPress={() => onDelete(entry)}>
        <Text style={styles.reorderIconText}>🗑</Text>
      </TouchableOpacity>
      <View style={styles.reorderHandle} {...panResponder.panHandlers}>
        <Text style={styles.reorderHandleText}>≡</Text>
      </View>
    </Animated.View>
  );
}

function DraggablePhotoList({
  photos,
  onReorder,
  onOpen,
  onDelete,
  onSaveToRoll,
}: {
  photos: SavedPhoto[];
  onReorder: (ordered: SavedPhoto[]) => void;
  onOpen: (entry: SavedPhoto) => void;
  onDelete: (entry: SavedPhoto) => void;
  onSaveToRoll: (uri: string) => void;
}) {
  const [data, setData] = useState<SavedPhoto[]>(photos);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  // Mirror draggingId in a ref so the gesture handlers read the live value
  // synchronously rather than a stale snapshot from a prior render.
  const draggingIdRef = useRef<number | null>(null);
  const startIndexRef = useRef(0);
  const dragTop = useRef(new Animated.Value(0)).current;

  // Re-sync from props only when the set/order of photos actually changes
  // (e.g. a photo is deleted or the persisted order updates) — not on every
  // parent re-render, which would clobber an in-progress drag.
  const idsKey = photos.map(p => p.id).join(',');
  useEffect(() => { setData(photos); }, [idsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleStart(id: number) {
    const index = dataRef.current.findIndex(p => p.id === id);
    if (index === -1) return;
    startIndexRef.current = index;
    dragTop.setValue(index * ROW_HEIGHT);
    draggingIdRef.current = id;
    setDraggingId(id);
  }

  function handleMove(dy: number) {
    const id = draggingIdRef.current;
    if (id == null) return;
    const visualTop = startIndexRef.current * ROW_HEIGHT + dy;
    dragTop.setValue(visualTop);
    const target = Math.max(0, Math.min(dataRef.current.length - 1, Math.round(visualTop / ROW_HEIGHT)));
    setData(prev => {
      const from = prev.findIndex(p => p.id === id);
      if (from === -1 || from === target) return prev;
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(target, 0, item);
      return next;
    });
  }

  function handleEnd() {
    if (draggingIdRef.current == null) return;
    draggingIdRef.current = null;
    setDraggingId(null);
    onReorder(dataRef.current);
  }

  return (
    <ScrollView
      contentContainerStyle={styles.reorderScroll}
      scrollEnabled={draggingId == null}
    >
      <View style={{ height: data.length * ROW_HEIGHT }}>
        {data.map((entry, index) => (
          <PhotoRow
            key={entry.id}
            entry={entry}
            top={entry.id === draggingId ? dragTop : index * ROW_HEIGHT}
            isDragging={entry.id === draggingId}
            onStart={handleStart}
            onMove={handleMove}
            onEnd={handleEnd}
            onOpen={onOpen}
            onDelete={onDelete}
            onSaveToRoll={onSaveToRoll}
          />
        ))}
      </View>
    </ScrollView>
  );
}

export default function App() {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const [permission, requestPermission] = useCameraPermissions();
  const [photo, setPhoto] = useState<string | null>(null);
  const [pins, setPins] = useState<Pin[]>([]);
  const [selectedPin, setSelectedPin] = useState<Pin | null>(null);
  const [noteText, setNoteText] = useState('');
  const [savedPhotos, setSavedPhotos] = useState<SavedPhoto[]>([]);
  const [showGallery, setShowGallery] = useState(false);
  const [folders, setFolders] = useState<Folder[]>([DEFAULT_FOLDER]);
  const [activeFolderId, setActiveFolderId] = useState<string>('general');
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [activeFolderView, setActiveFolderView] = useState<string | null>(null);
  const [showTitleModal, setShowTitleModal] = useState(false);
  const [titleText, setTitleText] = useState('');
  const [editingPhotoId, setEditingPhotoId] = useState<number | null>(null);
  const cameraRef = useRef<any>(null);
  const viewShotRef = useRef<any>(null);
  const [draggingPinId, setDraggingPinId] = useState<number | null>(null);
  const [photoTimestamp, setPhotoTimestamp] = useState<number | null>(null);

  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    if (photo) {
      Image.getSize(photo, (width, height) => {
        const lock = width > height
          ? ScreenOrientation.OrientationLock.LANDSCAPE
          : ScreenOrientation.OrientationLock.PORTRAIT_UP;
        ScreenOrientation.lockAsync(lock);
      });
    } else {
      ScreenOrientation.unlockAsync();
    }
  }, [photo]);

  async function loadData() {
    try {
      const folderData = await AsyncStorage.getItem(STORAGE_KEY_FOLDERS);
      const loadedFolders: Folder[] = folderData ? JSON.parse(folderData) : [];
      const hasGeneral = loadedFolders.some(f => f.id === 'general');
      const mergedFolders = hasGeneral ? loadedFolders : [DEFAULT_FOLDER, ...loadedFolders];
      setFolders(mergedFolders);

      const photoData = await AsyncStorage.getItem(STORAGE_KEY_PHOTOS);
      if (photoData) {
        const parsed: SavedPhoto[] = JSON.parse(photoData);
        const migrated = parsed.map(p => p.folderId ? p : { ...p, folderId: 'general' });
        if (parsed.some(p => !p.folderId)) {
          await AsyncStorage.setItem(STORAGE_KEY_PHOTOS, JSON.stringify(migrated));
        }
        setSavedPhotos(migrated);
      }
    } catch (e) { console.log('Error loading data', e); }
  }

  async function persistFolders(updated: Folder[]) {
    await AsyncStorage.setItem(STORAGE_KEY_FOLDERS, JSON.stringify(updated));
    setFolders(updated);
  }

  function createFolder(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const newFolder: Folder = { id: String(Date.now()), name: trimmed, createdAt: Date.now() };
    const updated = [...folders, newFolder];
    persistFolders(updated);
    setActiveFolderId(newFolder.id);
    setNewFolderName('');
    setShowNewFolderInput(false);
    setShowFolderPicker(false);
  }

  async function deleteFolder(id: string) {
    if (id === 'general') return;
    // Deleting a folder moves its photos to General rather than removing them.
    const updatedPhotos = savedPhotos.map(p => p.folderId === id ? { ...p, folderId: 'general' } : p);
    await AsyncStorage.setItem(STORAGE_KEY_PHOTOS, JSON.stringify(updatedPhotos));
    setSavedPhotos(updatedPhotos);
    const updatedFolders = folders.filter(f => f.id !== id);
    persistFolders(updatedFolders);
    if (activeFolderId === id) setActiveFolderId('general');
    if (activeFolderView === id) setActiveFolderView(null);
  }

  function getFolderPhotoCount(folderId: string): number {
    return savedPhotos.filter(p => p.folderId === folderId).length;
  }

  function getFolderThumbnail(folderId: string): string | null {
    const photos = savedPhotos
      .filter(p => p.folderId === folderId)
      .sort((a, b) => (b.timestamp ?? b.id) - (a.timestamp ?? a.id));
    return photos.length > 0 ? (photos[0].flatUri || photos[0].uri) : null;
  }

  async function generateFolderReport(folder: Folder) {
    const photos = savedPhotos
      .filter(p => p.folderId === folder.id)
      .sort((a, b) => (a.timestamp ?? a.id) - (b.timestamp ?? b.id));

    if (photos.length === 0) {
      Alert.alert('No Photos', 'This folder has no photos to include in a report.');
      return;
    }

    try {
      // Returns the first of the candidate uris that actually exists on disk.
      async function firstReadable(candidates: (string | undefined)[]): Promise<string | null> {
        for (const c of candidates) {
          if (!c) continue;
          try {
            const info = await FileSystem.getInfoAsync(c);
            if (info.exists) return c;
          } catch {}
        }
        return null;
      }

      const sections = await Promise.all(
        photos.map(async (p) => {
          const uri = await firstReadable([p.flatUri, p.uri]);
          if (!uri) return null;
          try {
            const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
            const date = new Date(p.timestamp ?? p.id).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
            return `
            <div class="page">
              <img src="data:image/jpeg;base64,${base64}" />
              <div class="caption">
                <span class="title">${p.title || 'Untitled'}</span>
                <span class="date">${date}</span>
              </div>
            </div>`;
          } catch {
            return null;
          }
        })
      );

      const photoSections = sections.filter((s): s is string => s !== null);

      if (photoSections.length === 0) {
        Alert.alert('No Photos Available', 'The image files for this folder could not be found. They may have been removed by the system. New photos will be stored permanently.');
        return;
      }

      const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  @page { size: 612px 792px; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; width: 612px; }
  .cover {
    width: 612px; height: 792px; overflow: hidden;
    page-break-after: always; page-break-inside: avoid;
    display: flex; flex-direction: column; justify-content: center; align-items: center;
    background: #0f0f0f; color: #fff; text-align: center; padding: 40px;
  }
  .cover h1 { font-size: 36px; font-weight: 700; margin-bottom: 12px; }
  .cover p { font-size: 16px; color: rgba(255,255,255,0.6); }
  .cover .meta { font-size: 14px; color: rgba(255,255,255,0.4); margin-top: 24px; }
  .page {
    width: 612px; height: 792px; overflow: hidden;
    page-break-after: always; page-break-inside: avoid;
    display: flex; flex-direction: column; justify-content: center; align-items: center;
    padding: 32px; background: #fff;
  }
  .page:last-child { page-break-after: auto; }
  .page img { max-width: 548px; max-height: 660px; object-fit: contain; border-radius: 6px; box-shadow: 0 3px 14px rgba(0,0,0,0.15); flex-shrink: 1; }
  .caption { margin-top: 14px; text-align: center; width: 100%; flex-shrink: 0; }
  .caption .title { display: block; font-size: 18px; font-weight: 600; color: #111; }
  .caption .date { display: block; font-size: 12px; color: #888; margin-top: 3px; }
</style>
</head>
<body>
  <div class="cover">
    <h1>${folder.name}</h1>
    <p>${photoSections.length} photo${photoSections.length !== 1 ? 's' : ''}</p>
    <p class="meta">Generated ${new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })} · PicPins</p>
  </div>
  ${photoSections.join('\n')}
</body>
</html>`;

      const { uri: pdfUri } = await Print.printToFileAsync({ html, base64: false });
      const safeName = folder.name.replace(/[^\w\s-]/g, '').trim();
      const filename = `${safeName} Report.pdf`;
      const namedUri = FileSystem.documentDirectory + filename;
      await FileSystem.copyAsync({ from: pdfUri, to: namedUri });
      await Sharing.shareAsync(namedUri, { mimeType: 'application/pdf', dialogTitle: filename });
      FileSystem.deleteAsync(pdfUri, { idempotent: true }).catch(() => {});
      FileSystem.deleteAsync(namedUri, { idempotent: true }).catch(() => {});
    } catch (e: any) {
      Alert.alert('Error', 'Could not generate report: ' + e.message);
    }
  }

  async function saveCurrentPhoto() {
    setShowTitleModal(true);
  }

  async function confirmSave(title: string, currentEditingId: number | null) {
    try {
      if (!viewShotRef.current) return;
      const captured = await viewShotRef.current.capture();
      let updated;
      if (currentEditingId) {
        const flatUri = await persistImage(captured, `flat_${currentEditingId}_${Date.now()}.jpg`);
        updated = savedPhotos.map(p => p.id === currentEditingId ? { ...p, title: title || 'Untitled', pins, flatUri } : p);
      } else {
        const now = Date.now();
        const uri = await persistImage(photo!, `photo_${now}.jpg`);
        const flatUri = await persistImage(captured, `flat_${now}.jpg`);
        const newEntry: SavedPhoto = { id: now, uri, flatUri, pins, title: title || 'Untitled', timestamp: photoTimestamp ?? now, folderId: activeFolderId };
        updated = [newEntry, ...savedPhotos];
      }
      const jsonString = JSON.stringify(updated);
      await AsyncStorage.setItem(STORAGE_KEY_PHOTOS, jsonString);
      setSavedPhotos(JSON.parse(jsonString));
      setShowTitleModal(false);
      setTitleText('');
      setEditingPhotoId(null);
      // Return to the capture screen after saving. Edits return to the gallery
      // they were opened from; new photos go straight back to the camera.
      setPhoto(null);
      setPins([]);
      setPhotoTimestamp(null);
      if (currentEditingId) setShowGallery(true);
      alert(currentEditingId ? 'Photo updated!' : 'Photo saved!');
    } catch (e: any) { alert('Error: ' + e.message); }
  }

  // Applies a new ordering of one folder's photos back into the global list,
  // leaving photos from other folders in their existing positions.
  async function reorderFolderPhotos(folderId: string, ordered: SavedPhoto[]) {
    let i = 0;
    const updated = savedPhotos.map(p => (p.folderId === folderId ? ordered[i++] : p));
    await AsyncStorage.setItem(STORAGE_KEY_PHOTOS, JSON.stringify(updated));
    setSavedPhotos(updated);
  }

  async function deletePhoto(id: number) {
    const updated = savedPhotos.filter(p => p.id !== id);
    await AsyncStorage.setItem(STORAGE_KEY_PHOTOS, JSON.stringify(updated));
    setSavedPhotos(updated);
  }

  async function takePhoto() {
    if (cameraRef.current) {
      const result = await cameraRef.current.takePictureAsync({
        exif: true,
        skipProcessing: false,
      });
      const manipulated = await ImageManipulator.manipulateAsync(
        result.uri,
        [{ rotate: 0 }],
        { compress: 1, format: ImageManipulator.SaveFormat.JPEG }
      );
      setPhoto(manipulated.uri);
      setPins([]);
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
    const { locationX, locationY } = event.nativeEvent;
    const newPin = { id: Date.now(), x: locationX, y: locationY, note: '' };
    setPins(prev => [...prev, newPin]);
    setSelectedPin(newPin);
    setNoteText('');
  }

  function handlePinTap(pin: Pin) {
    setSelectedPin(pin);
    setNoteText(pin.note);
  }

  function handlePinDrag(id: number, newX: number, newY: number, isDragging: boolean) {
  setDraggingPinId(isDragging ? id : null);
  setPins(prev => prev.map(p => p.id === id ? { ...p, x: newX, y: newY } : p));
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
    setPhoto(entry.uri);
    setPins(entry.pins);
    setEditingPhotoId(entry.id);
    setPhotoTimestamp(entry.timestamp ?? entry.id);
    setShowGallery(false);
    setActiveFolderView(null);
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
    const inFolder = activeFolderView !== null;
    const currentFolder = inFolder ? folders.find(f => f.id === activeFolderView) : null;
    const photosInView = inFolder ? savedPhotos.filter(p => p.folderId === activeFolderView) : [];

    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" />
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => {
              if (inFolder) {
                setActiveFolderView(null);
              } else {
                setShowGallery(false);
                setActiveFolderView(null);
              }
            }}
            style={styles.headerBack}
          >
            <Text style={styles.headerBackText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>
            {inFolder ? (currentFolder?.name ?? 'Folder') : 'My Photos'}
          </Text>
          <View style={{ width: 70 }} />
        </View>

        {inFolder ? (
          photosInView.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>📷</Text>
              <Text style={styles.emptyTitle}>No photos yet</Text>
              <Text style={styles.emptySubtitle}>
                Photos saved to "{currentFolder?.name}" will appear here
              </Text>
            </View>
          ) : (
            <>
              <Text style={styles.reorderHint}>Drag ≡ to reorder photos</Text>
              <DraggablePhotoList
                photos={photosInView}
                onReorder={(ordered) => reorderFolderPhotos(activeFolderView!, ordered)}
                onOpen={openSavedPhoto}
                onSaveToRoll={(uri) => saveGalleryPhotoToRoll(uri)}
                onDelete={(entry) => Alert.alert(
                  'Delete Photo',
                  `Delete "${entry.title || 'Untitled'}"? This cannot be undone.`,
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: () => deletePhoto(entry.id) },
                  ],
                )}
              />
            </>
          )
        ) : (
          <ScrollView contentContainerStyle={styles.galleryGrid}>
            {folders.map(folder => {
              const count = getFolderPhotoCount(folder.id);
              const thumb = getFolderThumbnail(folder.id);
              return (
                <View key={folder.id} style={styles.folderCard}>
                  <TouchableOpacity
                    style={styles.folderCardMain}
                    onPress={() => setActiveFolderView(folder.id)}
                  >
                    {thumb ? (
                      <Image source={{ uri: thumb }} style={styles.folderThumbnail} />
                    ) : (
                      <View style={[styles.folderThumbnail, styles.folderThumbnailEmpty]}>
                        <Text style={styles.folderEmptyIcon}>📁</Text>
                      </View>
                    )}
                    <View style={styles.folderCardInfo}>
                      <Text style={styles.folderName}>{folder.name}</Text>
                      <Text style={styles.folderCount}>{count} photo{count !== 1 ? 's' : ''}</Text>
                    </View>
                    {folder.id !== 'general' && (
                      <TouchableOpacity
                        style={styles.folderDeleteBtn}
                        onPress={() => Alert.alert(
                          'Delete Folder',
                          `Are you sure you want to delete "${folder.name}"? Its photos will be moved to General.`,
                          [
                            { text: 'Cancel', style: 'cancel' },
                            { text: 'Delete', style: 'destructive', onPress: () => deleteFolder(folder.id) },
                          ],
                        )}
                      >
                        <Text style={styles.folderDeleteText}>✕</Text>
                      </TouchableOpacity>
                    )}
                  </TouchableOpacity>
                  <View style={styles.folderCardActions}>
                    <TouchableOpacity
                      style={styles.folderReportBtn}
                      onPress={() => generateFolderReport(folder)}
                    >
                      <Text style={styles.folderReportBtnText}>📄 Generate Report</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        )}
      </View>
    );
  }

  if (photo) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" />
        <ViewShot ref={viewShotRef} style={styles.imageContainer}>
          <TouchableOpacity activeOpacity={1} onPress={handleImageTap} style={styles.imageContainer}>
            <Image source={{ uri: photo }} style={styles.camera} />
            <View style={styles.watermark}>
              <Text style={styles.watermarkText}>PicPins App</Text>
            </View>
            <View style={styles.timestamp}>
              <Text style={styles.timestampText}>
                {new Date(photoTimestamp ?? Date.now()).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} {new Date(photoTimestamp ?? Date.now()).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>
            {pins.map(pin => (
              <DraggablePin
                key={pin.id}
                pin={pin}
                onTap={handlePinTap}
                onDragEnd={handlePinDrag}
                isDragging={draggingPinId === pin.id}
              />
            ))}
          </TouchableOpacity>
        </ViewShot>

        {isLandscape ? (
          <View style={styles.photoRightBar}>
            <TouchableOpacity style={styles.iconBtn} onPress={() => { setPhoto(null); setEditingPhotoId(null); }}>
              <Text style={styles.iconBtnIcon}>✕</Text>
              <Text style={styles.iconBtnLabel}>New Photo</Text>
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
        ) : (
          <View style={styles.bottomBar}>
            <TouchableOpacity style={styles.iconBtn} onPress={() => { setPhoto(null); setEditingPhotoId(null); }}>
              <Text style={styles.iconBtnIcon}>✕</Text>
              <Text style={styles.iconBtnLabel}>New Photo</Text>
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
        )}

        <Modal visible={selectedPin !== null} transparent animationType="slide" supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}>
          <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <View style={styles.modalBox}>
              <View style={styles.modalHandle} />
              <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} bounces={false}>
                <Text style={styles.modalTitle}>📍 Pin Note</Text>
                <TextInput
                  style={[styles.textInput, isLandscape && styles.textInputLandscape]}
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
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        <Modal visible={showTitleModal} transparent animationType="slide" supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}>
          <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <View style={styles.modalBox}>
              <View style={styles.modalHandle} />
              <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} bounces={false}>
                <Text style={styles.modalTitle}>Name this photo</Text>
                <Text style={styles.folderDestinationLabel}>
                  Saving to: {folders.find(f => f.id === activeFolderId)?.name ?? 'General'}
                </Text>
                <TextInput
                  style={[styles.textInput, isLandscape && styles.textInputLandscape]}
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
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </Modal>
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
      <View style={[styles.cameraTopBar, isLandscape && styles.cameraTopBarLandscape]}>
        <Text style={styles.appName}>PicPins</Text>
        <TouchableOpacity style={styles.folderPill} onPress={() => setShowFolderPicker(true)}>
          <Text style={styles.folderPillText} numberOfLines={1}>
            📁 {folders.find(f => f.id === activeFolderId)?.name ?? 'General'}
          </Text>
          <Text style={styles.folderPillChevron}> ▾</Text>
        </TouchableOpacity>
      </View>
      {isLandscape ? (
        <View style={styles.cameraRightBar}>
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
      ) : (
        <View style={styles.cameraBottomBar}>
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
      )}

      <Modal
        visible={showFolderPicker}
        transparent
        animationType="slide"
        supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
      >
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalBox}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Select Folder</Text>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} bounces={false}>
              {folders.map(folder => (
                <TouchableOpacity
                  key={folder.id}
                  style={styles.folderPickerRow}
                  onPress={() => {
                    setActiveFolderId(folder.id);
                    setShowFolderPicker(false);
                    setShowNewFolderInput(false);
                  }}
                >
                  <Text style={styles.folderPickerRowText}>
                    {activeFolderId === folder.id ? '✓  ' : '    '}{folder.name}
                  </Text>
                </TouchableOpacity>
              ))}
              {showNewFolderInput ? (
                <View style={styles.newFolderRow}>
                  <TextInput
                    style={styles.newFolderInput}
                    placeholder="Folder name"
                    placeholderTextColor={COLORS.textSecondary}
                    value={newFolderName}
                    onChangeText={setNewFolderName}
                    autoFocus
                    onSubmitEditing={() => createFolder(newFolderName)}
                  />
                  <TouchableOpacity style={styles.newFolderConfirm} onPress={() => createFolder(newFolderName)}>
                    <Text style={styles.newFolderConfirmText}>Add</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={styles.folderPickerRow} onPress={() => setShowNewFolderInput(true)}>
                  <Text style={[styles.folderPickerRowText, { color: COLORS.accent }]}>+ New Folder</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
            <TouchableOpacity
              style={styles.deleteButton}
              onPress={() => { setShowFolderPicker(false); setShowNewFolderInput(false); setNewFolderName(''); }}
            >
              <Text style={styles.deleteText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  message: { textAlign: 'center', color: COLORS.text, fontSize: 16, padding: 24 },
  permissionButton: { backgroundColor: COLORS.accent, margin: 24, padding: 16, borderRadius: 12, alignItems: 'center' },
  permissionButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  camera: { flex: 1 },
  imageContainer: { flex: 1 },

  // Camera screen
  cameraTopBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    paddingTop: 56, paddingBottom: 16, paddingHorizontal: 24,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
  },
  appName: { color: '#fff', fontSize: 20, fontWeight: '700', letterSpacing: 1 },
  cameraTopBarLandscape: {
    paddingTop: 10,
    paddingBottom: 8,
  },
  cameraBottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
    paddingBottom: 48, paddingTop: 24,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  cameraRightBar: {
    position: 'absolute', right: 0, top: 0, bottom: 0,
    flexDirection: 'column', alignItems: 'center', justifyContent: 'space-around',
    width: 100,
    paddingVertical: 24, paddingHorizontal: 8,
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

  // Photo view
  bottomBar: {
    flexDirection: 'row', justifyContent: 'space-around',
    paddingVertical: 16, paddingBottom: 36,
    backgroundColor: COLORS.surface,
    borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  photoRightBar: {
    position: 'absolute', right: 0, top: 0, bottom: 0,
    flexDirection: 'column', alignItems: 'center', justifyContent: 'space-around',
    width: 110,
    paddingVertical: 24, paddingHorizontal: 8,
    backgroundColor: COLORS.surface,
    borderLeftWidth: 1, borderLeftColor: COLORS.border,
  },
  iconBtn: { alignItems: 'center', padding: 10, borderRadius: 12, minWidth: 70, backgroundColor: COLORS.surface2, borderWidth: 1, borderColor: COLORS.border },
  iconBtnAccent: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  iconBtnIcon: { fontSize: 22 },
  iconBtnLabel: { color: COLORS.text, fontSize: 11, marginTop: 4 },

  // Pins
  pin: { position: 'absolute', alignItems: 'center' },
  pinEmoji: { display: 'none' },
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
    paddingTop: 56, paddingBottom: 16, paddingHorizontal: 16,
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
  // Reorderable photo rows (in-folder view)
  reorderHint: { color: COLORS.textSecondary, fontSize: 13, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  reorderScroll: { padding: 16, paddingTop: 8 },
  reorderRow: {
    position: 'absolute', left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.surface, borderRadius: 14, overflow: 'hidden',
    borderWidth: 1, borderColor: COLORS.border,
  },
  reorderRowActive: {
    borderColor: COLORS.accent,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 8, elevation: 8,
  },
  reorderMain: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  reorderThumb: { width: 72, height: ROW_HEIGHT - 8 },
  reorderInfo: { flex: 1, paddingHorizontal: 12 },
  reorderTitle: { color: COLORS.text, fontSize: 15, fontWeight: '600' },
  reorderPins: { color: COLORS.textSecondary, fontSize: 12, marginTop: 3 },
  reorderIconBtn: { paddingHorizontal: 8, paddingVertical: 12, justifyContent: 'center', alignItems: 'center' },
  reorderIconText: { fontSize: 18 },
  reorderHandle: {
    width: 48, alignSelf: 'stretch',
    justifyContent: 'center', alignItems: 'center',
    backgroundColor: COLORS.surface2, borderLeftWidth: 1, borderLeftColor: COLORS.border,
  },
  reorderHandleText: { color: COLORS.textSecondary, fontSize: 22, fontWeight: '700' },

  emptyState: { alignItems: 'center', paddingTop: 80 },
  emptyEmoji: { fontSize: 48, marginBottom: 16 },
  emptyTitle: { color: COLORS.text, fontSize: 20, fontWeight: '600', marginBottom: 8 },
  emptySubtitle: { color: COLORS.textSecondary, fontSize: 14, textAlign: 'center', paddingHorizontal: 32 },

  // Modals
  modalOverlay: {
    flex: 1, justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  modalBox: {
    backgroundColor: COLORS.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 40,
    flexShrink: 1,
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
  textInputLandscape: {
    minHeight: 44,
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

  // Folder pill on camera screen
  folderPill: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5,
    marginTop: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)',
    maxWidth: 220,
  },
  folderPillText: { color: '#fff', fontSize: 13, fontWeight: '600', flexShrink: 1 },
  folderPillChevron: { color: 'rgba(255,255,255,0.7)', fontSize: 13 },

  // Folder cards in gallery level 1
  folderCard: {
    backgroundColor: COLORS.surface, borderRadius: 16, overflow: 'hidden',
    borderWidth: 1, borderColor: COLORS.border,
  },
  folderCardMain: {
    flexDirection: 'row', alignItems: 'center',
  },
  folderCardActions: {
    borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  folderReportBtn: {
    padding: 12, alignItems: 'center', backgroundColor: COLORS.surface2,
  },
  folderReportBtnText: { color: COLORS.accent, fontSize: 14, fontWeight: '600' },
  folderThumbnail: { width: 80, height: 80 },
  folderThumbnailEmpty: {
    backgroundColor: COLORS.surface2, justifyContent: 'center', alignItems: 'center',
  },
  folderEmptyIcon: { fontSize: 32 },
  folderCardInfo: { flex: 1, paddingHorizontal: 14 },
  folderName: { color: COLORS.text, fontSize: 16, fontWeight: '600' },
  folderCount: { color: COLORS.textSecondary, fontSize: 13, marginTop: 3 },
  folderDeleteBtn: { padding: 16, justifyContent: 'center', alignItems: 'center' },
  folderDeleteText: { color: COLORS.textSecondary, fontSize: 16 },

  // Folder picker modal
  folderPickerRow: {
    paddingVertical: 14, paddingHorizontal: 4,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  folderPickerRowText: { color: COLORS.text, fontSize: 16 },
  newFolderRow: { flexDirection: 'row', alignItems: 'center', paddingTop: 12, gap: 8 },
  newFolderInput: {
    flex: 1, backgroundColor: COLORS.surface2,
    borderWidth: 1, borderColor: COLORS.border,
    borderRadius: 10, padding: 12, fontSize: 15, color: COLORS.text,
  },
  newFolderConfirm: {
    backgroundColor: COLORS.accent, borderRadius: 10,
    paddingVertical: 12, paddingHorizontal: 16,
  },
  newFolderConfirmText: { color: '#fff', fontWeight: '600', fontSize: 15 },

  // Save modal destination label
  folderDestinationLabel: { color: COLORS.textSecondary, fontSize: 13, marginBottom: 12, marginTop: -8 },
});