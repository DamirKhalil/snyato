'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type WatchedFileHandle = {
  kind: 'file';
  name: string;
  getFile: () => Promise<File>;
};
type WatchedDirectoryHandle = {
  kind: 'directory';
  name: string;
  values: () => AsyncIterable<WatchedFileHandle | WatchedDirectoryHandle>;
};
type DirectoryPicker = (options: { mode: 'read'; id: string }) => Promise<WatchedDirectoryHandle>;
type Observation = { fingerprint: string; count: number };
type FailedFile = { fingerprint: string; retryAfter: number };

const POLL_MS = 30_000;
const RETRY_MS = 5 * 60_000;
const OPEN_TAB_NOTE = 'Проверка каждые 30 секунд, пока эта вкладка открыта.';

function picker(): DirectoryPicker | undefined {
  const choose = (window as Window & { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;
  return choose?.bind(window);
}

function shouldIgnore(name: string): boolean {
  return name.startsWith('.') || name.startsWith('~') || /(?:\.tmp|\.temp|\.part|\.partial|\.crdownload|\.download|\.swp|\.lock|\.filepart)$/iu.test(name);
}

/** Watches only the selected directory, never subdirectories or a closed browser tab. */
export function useFolderWatch(courseId: string, onFiles: (files: File[]) => Promise<void>) {
  const [supported, setSupported] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [watching, setWatching] = useState(false);
  const [status, setStatus] = useState('Выберите папку курса. ' + OPEN_TAB_NOTE);
  const directoryRef = useRef<WatchedDirectoryHandle | null>(null);
  const generationRef = useRef(0);
  const pickerAttemptRef = useRef(0);
  const busyGenerationRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);
  const observationsRef = useRef(new Map<string, Observation>());
  const seenRef = useRef(new Map<string, string>());
  const failedRef = useRef(new Map<string, FailedFile>());
  const mountedRef = useRef(false);
  const courseRef = useRef(courseId);
  const callbackRef = useRef(onFiles);

  // A scan retains the callback for the course in which it began.
  courseRef.current = courseId;
  callbackRef.current = onFiles;

  const tearDown = useCallback(() => {
    generationRef.current++;
    pickerAttemptRef.current++;
    if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
    intervalRef.current = null;
    directoryRef.current = null;
    observationsRef.current.clear();
    seenRef.current.clear();
    failedRef.current.clear();
  }, []);

  const disconnect = useCallback(() => {
    tearDown();
    if (!mountedRef.current) return;
    setFolderName('');
    setWatching(false);
    setStatus('Папка отключена. ' + OPEN_TAB_NOTE);
  }, [tearDown]);

  const scan = useCallback(async () => {
    const directory = directoryRef.current;
    const generation = generationRef.current;
    const scanCourse = courseRef.current;
    if (!directory || busyGenerationRef.current === generation || !mountedRef.current) return;
    busyGenerationRef.current = generation;
    const callback = callbackRef.current;
    const current = () => mountedRef.current && generation === generationRef.current && scanCourse === courseRef.current;
    const observedNames = new Set<string>();
    let added = 0;
    let pending = 0;
    let failures = 0;
    try {
      for await (const entry of directory.values()) {
        if (!current()) return;
        if (entry.kind !== 'file' || shouldIgnore(entry.name)) continue;
        observedNames.add(entry.name);
        try {
          const file = await entry.getFile();
          if (!current()) return;
          if (!file.size) {
            observationsRef.current.delete(entry.name);
            continue;
          }
          const fingerprint = `${file.size}:${file.lastModified}`;
          if (seenRef.current.get(entry.name) === fingerprint) continue;
          const previous = observationsRef.current.get(entry.name);
          const observation = {
            fingerprint,
            count: previous?.fingerprint === fingerprint ? previous.count + 1 : 1,
          };
          observationsRef.current.set(entry.name, observation);
          if (observation.count < 2) {
            pending++;
            continue;
          }
          const failed = failedRef.current.get(entry.name);
          if (failed?.fingerprint === fingerprint && Date.now() < failed.retryAfter) {
            failures++;
            continue;
          }
          if (!current()) return;
          setStatus(`Добавляем «${entry.name}». ${OPEN_TAB_NOTE}`);
          try {
            await callback([file]);
            if (!current()) return;
            seenRef.current.set(entry.name, fingerprint);
            failedRef.current.delete(entry.name);
            added++;
          } catch {
            if (!current()) return;
            failedRef.current.set(entry.name, { fingerprint, retryAfter: Date.now() + RETRY_MS });
            failures++;
            setStatus(`Не удалось добавить «${entry.name}». Повтор через 5 минут. ${OPEN_TAB_NOTE}`);
          }
        } catch {
          if (!current()) return;
          // An export may replace or temporarily lock a file between directory enumeration and reading it.
          observationsRef.current.delete(entry.name);
          pending++;
        }
      }
      if (!current()) return;
      for (const name of observationsRef.current.keys()) {
        if (!observedNames.has(name)) observationsRef.current.delete(name);
      }
      const result = failures
        ? 'Есть файлы с ошибкой загрузки. Повтор через 5 минут.'
        : added
          ? `Добавлено файлов: ${added}.`
          : pending
            ? 'Найдены новые файлы. Проверяем, завершилось ли сохранение.'
            : `Наблюдаем папку «${directory.name}».`;
      setStatus(`${result} ${OPEN_TAB_NOTE}`);
    } catch (error) {
      if (!current()) return;
      const denied = error instanceof DOMException && ['NotAllowedError', 'SecurityError'].includes(error.name);
      if (denied) {
        tearDown();
        setWatching(false);
        setFolderName('');
        setStatus('Доступ к папке закрыт. Выберите её снова. ' + OPEN_TAB_NOTE);
      } else {
        setStatus('Папка сейчас недоступна. Проверим снова через 30 секунд. ' + OPEN_TAB_NOTE);
      }
    } finally {
      if (busyGenerationRef.current === generation) busyGenerationRef.current = null;
    }
  }, [tearDown]);

  const pickFolder = useCallback(async () => {
    const choose = picker();
    if (!choose) {
      setStatus('Этот браузер не поддерживает выбор папки. Используйте ручную загрузку файлов.');
      return;
    }
    const attempt = ++pickerAttemptRef.current;
    const selectingCourse = courseRef.current;
    try {
      const directory = await choose({ mode: 'read', id: 'snyato-course-folder' });
      if (!mountedRef.current || attempt !== pickerAttemptRef.current || selectingCourse !== courseRef.current) return;
      tearDown();
      directoryRef.current = directory;
      setFolderName(directory.name);
      setWatching(true);
      setStatus(`Наблюдаем папку «${directory.name}». ${OPEN_TAB_NOTE}`);
      intervalRef.current = window.setInterval(() => { void scan(); }, POLL_MS);
      // First observation only: files are imported after a second unchanged observation.
      void scan();
    } catch (error) {
      if (!mountedRef.current || attempt !== pickerAttemptRef.current || selectingCourse !== courseRef.current) return;
      if (error instanceof DOMException && error.name === 'AbortError') {
        setStatus(directoryRef.current ? `Наблюдаем папку «${directoryRef.current.name}». ${OPEN_TAB_NOTE}` : 'Выбор папки отменён. ' + OPEN_TAB_NOTE);
        return;
      }
      setStatus('Не удалось открыть папку. Проверьте разрешение браузера или загрузите файлы вручную.');
    }
  }, [scan, tearDown]);

  useEffect(() => {
    mountedRef.current = true;
    setSupported(typeof picker() === 'function');
    return () => {
      mountedRef.current = false;
      tearDown();
    };
  }, [tearDown]);

  useEffect(() => {
    tearDown();
    setFolderName('');
    setWatching(false);
    setStatus('Выберите папку этого курса. ' + OPEN_TAB_NOTE);
    return tearDown;
  }, [courseId, tearDown]);

  return { supported, folderName, watching, status, pickFolder, disconnect };
}
