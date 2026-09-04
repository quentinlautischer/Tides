import Modal from './Modal';
import ObservationJump from './ObservationJump';
import type { Station } from '../types';

interface Props {
  open: boolean;
  selectedStation: Station | null;
  onSelectStation: (station: Station) => void;
  onJump: (date: string, time: string) => void;
  onClose: () => void;
}

/**
 * The sighting lookup, behind the same kind of dialog as the station picker. It is only
 * mounted while open, so each visit starts on an empty form rather than the last link
 * that was pasted into it.
 */
export default function ObservationJumpDialog({ open, selectedStation, onSelectStation, onJump, onClose }: Props) {
  if (!open) return null;

  return (
    <Modal
      title="Jump to a sighting"
      subtitle="Paste an iNaturalist observation link to see the tide when it was recorded"
      onClose={onClose}
    >
      <ObservationJump
        selectedStation={selectedStation}
        onSelectStation={onSelectStation}
        onJump={onJump}
        onViewOnChart={onClose}
      />
    </Modal>
  );
}
