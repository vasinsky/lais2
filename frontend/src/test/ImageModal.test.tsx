import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ImageModal from '../components/ImageModal';

describe('ImageModal Component', () => {
  it('does not render when isOpen is false', () => {
    const { container } = render(
      <ImageModal isOpen={false} imageUrl={null} onClose={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders modal with full image and prompt details', () => {
    const handleClose = vi.fn();
    render(
      <ImageModal
        isOpen={true}
        imageUrl="/api/chat/image/view?filename=cyber.png"
        prompt="neon cityscape 8k octane"
        onClose={handleClose}
      />
    );

    // Проверяем реальный alt из компонента ImageModal
    expect(screen.getByAltText('Generated high-res')).toBeInTheDocument();
    expect(screen.getByText(/neon cityscape 8k octane/i)).toBeInTheDocument();

    // Закрытие по кнопке с крестиком
    const closeBtn = screen.getByTitle(/Закрыть/i);
    fireEvent.click(closeBtn);
    expect(handleClose).toHaveBeenCalled();
  });
});
