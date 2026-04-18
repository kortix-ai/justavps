def qemu_hook(instance, stage):
    if stage == "config":
        conf = get_qemu_conf()
        
        # Strip all GUI/audio/USB/spice devices + unused PCIe ports
        # These add firmware enumeration time during OVMF boot
        new_conf = []
        skip_names = [
            "qemu_gpu", "qemu_keyboard", "qemu_tablet", "qemu_usb",
            "qemu_spice-usb1", "qemu_spice-usb2", "qemu_spice-usb3",
            "qemu_spice-usb-chardev1", "qemu_spice-usb-chardev2", "qemu_spice-usb-chardev3",
            "qemu_spice-audio", "qemu_spice-audiodev",
            "qemu_spice", "qemu_spice-chardev",
            "qemu_spicedir", "qemu_spicedir-chardev",
            "qemu_pcie5", "qemu_pcie6", "qemu_pcie7",
            "qemu_pcie8", "qemu_pcie9", "qemu_pcie10",
            "qemu_pcie11", "qemu_pcie12",
        ]
        
        removed = 0
        for section in conf:
            skip = False
            section_str = str(section)
            for name in skip_names:
                if name in section_str:
                    skip = True
                    removed = removed + 1
                    break
            if not skip:
                new_conf.append(section)
        
        set_qemu_conf(new_conf)
        log_info("Stripped " + str(removed) + " device sections for fast boot")
